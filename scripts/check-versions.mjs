#!/usr/bin/env node
/*
 * check-versions.mjs — version-consistency guard for the SendPing SDK monorepo.
 *
 * RUN IT:
 *   node scripts/check-versions.mjs            # internal consistency only
 *   node scripts/check-versions.mjs v2.0.1     # ^ plus: everything must equal the tag
 *   node scripts/check-versions.mjs --tag v2.0.1
 *
 * Exit 0 = every version coordinate agrees. Exit 1 = it names the file and both
 * values so the fix needs no further digging. No dependencies, no build step —
 * plain node, runnable from a clean checkout and from any CI job.
 *
 * WHAT IT CHECKS
 *   1. Every version coordinate across all 9 SDKs is IDENTICAL. Four packages
 *      carry a hand-maintained VERSION constant with nothing else binding it to
 *      its manifest (npm, python, java, dotnet); php and go have ONLY the
 *      constant. All of them are coordinates here.
 *   2. With a tag argument: they all equal the tag (v2.0.1 -> 2.0.1). Nothing
 *      else in this repo checks that the pushed tag is what the packages
 *      actually publish.
 *   3. sendping-cli's "sendping" dependency range tracks the version being
 *      released. The 2.0.0 cycle shipped a declared ^1.4.0 — a version that
 *      would never exist — and it was caught by hand, not by CI.
 *   4. The Go module path's /vN suffix agrees with the major (major >= 2 needs
 *      /vN, major 1 needs none). Getting this wrong silently publishes a module
 *      nobody can `go get`, and the unsuffixed path keeps resolving to the old
 *      major, so the failure is quiet.
 *   5. pom.xml <scm><tag>, which no grep for the current version ever touches —
 *      it sat three releases stale at v1.0.0.
 *   6. sendping-php/tests/cases/ErrorsTest.php's hard-coded version literal —
 *      the only such literal in any of the nine suites. It is here because
 *      missing it is green-then-fatal: the PHP suite is packagist-split's
 *      publish gate, and that job runs AFTER six registries have shipped.
 *   7. The `go get` / import lines in the root and Go READMEs, which must carry
 *      the same major suffix as go.mod. Unlike (4), a stale suffix here never
 *      404s — the old major keeps resolving — so readers silently install the
 *      previous version. Added in the 5.0.0 cycle; both (6) and (7) were found
 *      by audit rather than by this guard, which is why they are now in it.
 *
 * WHERE IT RUNS
 *   .github/workflows/sdks.yml    — every push/PR (internal-consistency half)
 *   .github/workflows/release.yml — the `versions` job, which every publish job
 *                                   `needs`. It MUST stay ahead of publishing:
 *                                   registries are append-only, so a guard that
 *                                   runs afterwards reports a fact nobody can act on.
 *
 * ADDING A COORDINATE: append to COORDINATES below. `extract` returns the raw
 * string found; `normalize` (optional) maps it to a bare version for comparison.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Read a repo-relative file, failing with the path rather than an ENOENT stack. */
function read(relPath) {
  try {
    return readFileSync(join(REPO_ROOT, relPath), 'utf8');
  } catch {
    throw new Error(`cannot read ${relPath} — has the package moved or been renamed?`);
  }
}

/** Apply a regex whose first capture group is the value; fail naming the file. */
function capture(relPath, re, what) {
  const text = read(relPath);
  const m = text.match(re);
  if (!m) {
    throw new Error(
      `${relPath}: no ${what} found (pattern ${re}). ` +
        `If the declaration moved, update COORDINATES in scripts/check-versions.mjs.`
    );
  }
  return m[1].trim();
}

/** Value of `key = "..."` inside a given TOML [section]. Enough for pyproject/Cargo. */
function tomlValue(relPath, section, key) {
  const text = read(relPath);
  const body = text.split(/^\[/m).find((chunk) => chunk.startsWith(`${section}]`));
  if (body === undefined) throw new Error(`${relPath}: no [${section}] section`);
  const m = body.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm'));
  if (!m) throw new Error(`${relPath}: no ${key} in [${section}]`);
  return m[1].trim();
}

/** `"version"` out of a package.json, via a real JSON parse. */
function packageJson(relPath) {
  try {
    return JSON.parse(read(relPath));
  } catch (err) {
    throw new Error(`${relPath}: not valid JSON — ${err.message}`);
  }
}

const stripV = (s) => s.replace(/^v/, '');

/*
 * Every version coordinate in the monorepo. `label` is what a failure prints,
 * so it should read as an instruction: package + the exact declaration.
 */
const COORDINATES = [
  // ---- npm ----
  {
    label: 'npm package.json "version"',
    file: 'sendping-npm/package.json',
    extract: () => packageJson('sendping-npm/package.json').version,
  },
  {
    label: 'npm src/client.ts VERSION const',
    file: 'sendping-npm/src/client.ts',
    extract: () =>
      capture(
        'sendping-npm/src/client.ts',
        /export\s+const\s+VERSION\s*=\s*['"]([^'"]+)['"]/,
        'VERSION const'
      ),
  },

  // ---- cli ----
  {
    label: 'cli package.json "version"',
    file: 'sendping-cli/package.json',
    extract: () => packageJson('sendping-cli/package.json').version,
  },
  {
    // The ^1.4.0 bug. Compared as a bare version after stripping the range
    // operator, so `^2.0.0`, `~2.0.0` and `2.0.0` all pass while any range
    // pinned at a different version — published or not — fails.
    label: 'cli package.json dependencies.sendping range',
    file: 'sendping-cli/package.json',
    extract: () => {
      const pkg = packageJson('sendping-cli/package.json');
      const range = pkg.dependencies?.sendping;
      if (!range) {
        throw new Error(
          'sendping-cli/package.json: no "sendping" entry under dependencies — ' +
            'the CLI must declare the SDK it is published against.'
        );
      }
      return range;
    },
    normalize: (range) => {
      const m = range.match(/^\s*(?:\^|~|=|>=)?\s*(\d+\.\d+\.\d+[^\s|]*)\s*$/);
      if (!m) {
        throw new Error(
          `sendping-cli/package.json: dependencies.sendping is "${range}", which is not a ` +
            'single pinned range. Use "^X.Y.Z" matching the version being released.'
        );
      }
      return m[1];
    },
  },

  // ---- python ----
  {
    label: 'python pyproject.toml [project] version',
    file: 'sendping-python/pyproject.toml',
    extract: () => tomlValue('sendping-python/pyproject.toml', 'project', 'version'),
  },
  {
    label: 'python sendping/http_client.py VERSION',
    file: 'sendping-python/sendping/http_client.py',
    extract: () =>
      capture(
        'sendping-python/sendping/http_client.py',
        /^VERSION\s*=\s*["']([^"']+)["']/m,
        'VERSION assignment'
      ),
  },

  // ---- ruby ----
  {
    label: 'ruby lib/sendping/version.rb VERSION',
    file: 'sendping-ruby/lib/sendping/version.rb',
    extract: () =>
      capture(
        'sendping-ruby/lib/sendping/version.rb',
        /VERSION\s*=\s*["']([^"']+)["']/,
        'VERSION const'
      ),
  },

  // ---- php (the const is the ONLY declaration; composer.json carries none) ----
  {
    label: 'php src/SendPing.php const VERSION',
    file: 'sendping-php/src/SendPing.php',
    extract: () =>
      capture(
        'sendping-php/src/SendPing.php',
        /const\s+VERSION\s*=\s*['"]([^'"]+)['"]/,
        'const VERSION'
      ),
  },

  {
    // The ONLY hard-coded version literal in any of the nine test suites, and it
    // was not a coordinate until 5.0.0. Missing it is uniquely expensive: the
    // guard stays green (the const it asserts against was bumped correctly), so
    // every publish job starts — and the red PHP suite surfaces inside
    // `packagist-split`, which runs `php tests/run.php` as its publish gate
    // AFTER npm, PyPI, RubyGems, crates, NuGet and Maven have already shipped.
    // The outcome is eight registries at the new version, Packagist stranded on
    // the old one, and an immutable tag pointing at a commit whose PHP suite is
    // red. Cheap to check here, unrecoverable to discover there.
    label: 'php tests/cases/ErrorsTest.php version assertion',
    file: 'sendping-php/tests/cases/ErrorsTest.php',
    extract: () =>
      capture(
        'sendping-php/tests/cases/ErrorsTest.php',
        /check_same\(\s*'client: version'\s*,\s*'([^']+)'/,
        "check_same('client: version', ...) literal"
      ),
  },

  // ---- go (go.mod declares no version; the const is it) ----
  {
    label: 'go client.go Version const',
    file: 'sendping-go/client.go',
    extract: () =>
      capture('sendping-go/client.go', /\bVersion\s*=\s*"([^"]+)"/, 'Version const'),
  },

  // ---- rust ----
  {
    label: 'rust Cargo.toml [package] version',
    file: 'sendping-rust/Cargo.toml',
    extract: () => tomlValue('sendping-rust/Cargo.toml', 'package', 'version'),
  },

  // ---- java ----
  {
    // Anchored to the project's own artifactId: a bare <version> match would
    // hit the first plugin or dependency version in the file.
    label: 'java pom.xml project <version>',
    file: 'sendping-java/pom.xml',
    extract: () =>
      capture(
        'sendping-java/pom.xml',
        /<artifactId>sendping<\/artifactId>\s*<version>([^<]+)<\/version>/,
        'project <version>'
      ),
  },
  {
    // Stale at v1.0.0 for three releases because nothing greps a `v`-prefixed
    // value when looking for the current version.
    label: 'java pom.xml <scm><tag>',
    file: 'sendping-java/pom.xml',
    extract: () =>
      capture('sendping-java/pom.xml', /<scm>[\s\S]*?<tag>([^<]+)<\/tag>/, '<scm><tag>'),
    normalize: stripV,
    expectedForm: (version) => `v${version}`,
  },
  {
    label: 'java SendPing.java VERSION',
    file: 'sendping-java/src/main/java/co/sendping/SendPing.java',
    extract: () =>
      capture(
        'sendping-java/src/main/java/co/sendping/SendPing.java',
        /String\s+VERSION\s*=\s*"([^"]+)"/,
        'VERSION const'
      ),
  },

  // ---- dotnet ----
  {
    label: 'dotnet SendPing.csproj <Version>',
    file: 'sendping-dotnet/src/SendPing/SendPing.csproj',
    extract: () =>
      capture(
        'sendping-dotnet/src/SendPing/SendPing.csproj',
        /<Version>([^<]+)<\/Version>/,
        '<Version>'
      ),
  },
  {
    label: 'dotnet SendPingClient.cs Version const',
    file: 'sendping-dotnet/src/SendPing/SendPingClient.cs',
    extract: () =>
      capture(
        'sendping-dotnet/src/SendPing/SendPingClient.cs',
        /const\s+string\s+Version\s*=\s*"([^"]+)"/,
        'Version const'
      ),
  },

  // ---- README install snippets ----
  // Not publish coordinates — no registry reads them — but they are what users
  // copy-paste, so a stale one is a support ticket rather than a failed deploy.
  // This gap was demonstrated, not assumed: a complete, correct bump of all 15
  // coordinates passed the guard while both READMEs still advertised the
  // previous version. Each regex is anchored to its exact snippet so ordinary
  // prose (and any changelog-style text) cannot match.
  {
    label: 'root README.md SDK release version',
    file: 'README.md',
    extract: () => capture('README.md', /\*\*SDK release: v([0-9][^\s]*)\.\*\*/, 'SDK release version line'),
  },
  {
    label: 'root README.md package table — Maven coordinate',
    file: 'README.md',
    extract: () => capture('README.md', /`co\.sendping:sendping:([^`]+)`/, 'co.sendping:sendping coordinate'),
  },
  {
    label: 'root README.md Maven snippet <version>',
    file: 'README.md',
    extract: () => capture('README.md', /<version>([^<]+)<\/version>/, 'Maven snippet <version>'),
  },
  {
    label: 'java README.md Maven snippet <version>',
    file: 'sendping-java/README.md',
    extract: () => capture('sendping-java/README.md', /<version>([^<]+)<\/version>/, 'Maven snippet <version>'),
  },
  {
    label: 'java README.md Gradle snippet',
    file: 'sendping-java/README.md',
    extract: () => capture('sendping-java/README.md', /implementation\s+'co\.sendping:sendping:([^']+)'/, 'Gradle coordinate'),
  },
];

/**
 * The Go module path must carry a /vN suffix matching the major from v2 on.
 * Without it the module publishes under the previous major's path: `go get`
 * silently keeps serving the old version instead of 404ing.
 */
function checkGoModuleSuffix(version, failures) {
  const relPath = 'sendping-go/go.mod';
  const modulePath = capture(relPath, /^module\s+(\S+)/m, 'module path');
  const major = Number.parseInt(version.split('.')[0], 10);
  if (!Number.isFinite(major)) {
    failures.push(`${relPath}: cannot read a major version out of "${version}"`);
    return;
  }

  const suffixMatch = modulePath.match(/\/v(\d+)$/);
  const declaredMajor = suffixMatch ? Number.parseInt(suffixMatch[1], 10) : 1;

  if (major >= 2 && !suffixMatch) {
    failures.push(
      `${relPath}: module path is "${modulePath}" but the version is ${version}. ` +
        `Go requires a /v${major} suffix from major 2 on — expected "${modulePath}/v${major}". ` +
        'Without it the module publishes under the v1 path and nobody can install it.'
    );
  } else if (major >= 2 && declaredMajor !== major) {
    failures.push(
      `${relPath}: module path ends in /v${declaredMajor} but the version is ${version} ` +
        `(major ${major}). Expected the path to end in /v${major}.`
    );
  } else if (major === 1 && suffixMatch) {
    failures.push(
      `${relPath}: module path ends in /v${declaredMajor} but the version is ${version} ` +
        '(major 1). Go requires NO major suffix on v0/v1 — drop it.'
    );
  }
}

/**
 * Every `go get` / import line a user copies must carry the SAME major suffix as
 * go.mod. checkGoModuleSuffix above only proves the module PUBLISHES correctly;
 * it says nothing about the four README lines that tell people how to install it.
 * That gap is worse than it sounds, because a stale suffix does not 404 — the
 * previous major's path keeps resolving forever, so everyone who follows the
 * README silently stays on the old major with no error to notice. The v4.0.0
 * cycle shipped exactly this way and it was caught by hand.
 */
function checkGoPathReferences(version, failures) {
  const major = Number.parseInt(version.split('.')[0], 10);
  const expected =
    capture('sendping-go/go.mod', /^module\s+(\S+)/m, 'module path');
  const wanted = major >= 2 ? expected : expected.replace(/\/v\d+$/, '');

  // Any occurrence of the module path, with or without a major suffix.
  const anyPath = /github\.com\/shekhu10\/sendping-sdks\/sendping-go(?:\/v\d+)?/g;

  for (const relPath of ['README.md', 'sendping-go/README.md']) {
    const lines = read(relPath).split('\n');
    lines.forEach((line, i) => {
      for (const found of line.match(anyPath) ?? []) {
        if (found !== wanted) {
          failures.push(
            `${relPath}:${i + 1}: Go module path is "${found}" but go.mod declares "${expected}" ` +
              `(version ${version}). Expected "${wanted}".\n` +
              '      A wrong major suffix here does NOT 404 — the old major keeps resolving, so ' +
              'every reader silently installs the previous version.'
          );
        }
      }
    });
  }
}

function main(argv) {
  const raw = argv.find((a) => a !== '--tag' && !a.startsWith('--')) ?? '';
  const tag = raw.trim();

  if (tag && !/^v?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(tag)) {
    console.error(`FAIL: "${tag}" is not a version tag (expected e.g. v2.0.1).`);
    return 1;
  }

  // Read every coordinate first, so a broken pattern is reported as itself
  // rather than as a phantom version mismatch.
  const readings = [];
  const failures = [];
  for (const coord of COORDINATES) {
    try {
      const found = coord.extract();
      const normalized = coord.normalize ? coord.normalize(found) : found;
      readings.push({ ...coord, found, normalized });
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (failures.length) {
    console.error('FAIL: could not read every version coordinate.\n');
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }

  // The reference. With a tag it IS the tag. Without one, use the value the
  // most coordinates agree on rather than any single designated file: the
  // realistic failure is one forgotten declaration, and blaming the majority on
  // behalf of the straggler would print 14 wrong lines instead of 1. Ties fall
  // back to the npm manifest, the first coordinate read.
  let expected;
  let referenceLabel;
  if (tag) {
    expected = stripV(tag);
    referenceLabel = `tag ${tag}`;
  } else {
    const tally = new Map();
    for (const r of readings) tally.set(r.normalized, (tally.get(r.normalized) ?? 0) + 1);
    const top = Math.max(...tally.values());
    const winners = [...tally].filter(([, n]) => n === top).map(([v]) => v);
    expected = winners.length === 1 ? winners[0] : readings[0].normalized;
    referenceLabel =
      winners.length === 1 && top > 1
        ? `the ${top} coordinates that agree on ${expected}`
        : `${readings[0].label} (${relative('.', readings[0].file)})`;
  }

  for (const r of readings) {
    if (r.normalized !== expected) {
      const wanted = r.expectedForm ? r.expectedForm(expected) : expected;
      failures.push(
        `${r.file}\n      ${r.label}\n      found:    ${r.found}\n      expected: ${wanted}`
      );
    }
  }

  checkGoModuleSuffix(expected, failures);
  checkGoPathReferences(expected, failures);

  if (failures.length) {
    console.error(`FAIL: version coordinates disagree with ${referenceLabel}.\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    console.error(
      'Every coordinate above must carry the same version before anything is published.\n' +
        'Registries are append-only — a wrong version cannot be taken back.'
    );
    return 1;
  }

  const width = Math.max(...readings.map((r) => r.label.length));
  console.log(`OK: all ${readings.length} version coordinates agree on ${expected}.`);
  console.log(tag ? `    (checked against ${referenceLabel})\n` : '');
  for (const r of readings) {
    console.log(`  ${r.label.padEnd(width)}  ${r.found}`);
  }
  const modulePath = capture('sendping-go/go.mod', /^module\s+(\S+)/m, 'module path');
  console.log(`  ${'go.mod module path'.padEnd(width)}  ${modulePath}`);
  if (!tag) {
    console.log('\n  (no tag given — internal consistency only; pass a tag to check the release)');
  }
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}
