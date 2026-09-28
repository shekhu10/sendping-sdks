# SendPing SDKs

Official client libraries and tools for the [SendPing](https://www.sendping.co) email API — one package per ecosystem, all mirroring the same resource surface (emails, receiving, domains, contacts, segments, topics, campaigns, templates, automations, webhooks, events, API keys, logs, polls) with the platform's domain-first model and Svix-style webhook signature verification.

**SDK release: v1.0.0.** Grab your API key from the [SendPing dashboard](https://www.sendping.co) → API Keys, and you're one snippet away from the inbox.

| Package | Language | Install | Registry |
|---|---|---|---|
| [`sendping-npm`](./sendping-npm) | Node.js ≥ 18 | `npm install sendping` | [npm](https://www.npmjs.com/package/sendping) |
| [`sendping-python`](./sendping-python) | Python ≥ 3.8 | `pip install sendping` | [PyPI](https://pypi.org/project/sendping/) |
| [`sendping-go`](./sendping-go) | Go ≥ 1.22 | `go get github.com/shekhu10/sendping-sdks/sendping-go` | Go modules |
| [`sendping-ruby`](./sendping-ruby) | Ruby ≥ 2.7 | `gem install sendping` | [RubyGems](https://rubygems.org/gems/sendping) |
| [`sendping-php`](./sendping-php) | PHP ≥ 8.1 | `composer require sendping/sendping` | Packagist |
| [`sendping-java`](./sendping-java) | Java ≥ 11 | `co.sendping:sendping:1.0.0` | Maven Central |
| [`sendping-dotnet`](./sendping-dotnet) | .NET 8 | `dotnet add package SendPing` | [NuGet](https://www.nuget.org/packages/SendPing) |
| [`sendping-rust`](./sendping-rust) | Rust ≥ 1.75 | `cargo add sendping` | [crates.io](https://crates.io/crates/sendping) |
| [`sendping-cli`](./sendping-cli) | Node CLI | `npm i -g sendping-cli` | [npm](https://www.npmjs.com/package/sendping-cli) |

Every package: base URL `https://www.sendping.co/api`, Bearer `mb_…` keys, the API's `{statusCode, name, message}` error shape, percent-encoded path ids, and `domain`-scoped contacts/segments/topics/campaigns per the [docs](https://www.sendping.co/docs/api/introduction).

## Quickstart — send your first email

### Node.js

```bash
npm install sendping
```

```ts
import { SendPing } from 'sendping';

const mb = new SendPing('mb_xxxxxxxxx');

const { data, error } = await mb.emails.send({
  from: 'Acme <hello@yourdomain.com>',
  to: ['user@example.com'],
  subject: 'Hello from SendPing',
  html: '<p>Your first email 🎉</p>',
});
if (error) console.error(error.name, error.message);
else console.log('sent', data.id);
```

### Python

```bash
pip install sendping
```

```python
import sendping

sendping.api_key = "mb_xxxxxxxxx"

email = sendping.Emails.send({
    "from": "Acme <hello@yourdomain.com>",
    "to": ["user@example.com"],
    "subject": "Hello from SendPing",
    "html": "<p>Your first email 🎉</p>",
})
print(email["id"])
```

### Go

```bash
go get github.com/shekhu10/sendping-sdks/sendping-go
```

```go
client := sendping.NewClient("mb_xxxxxxxxx")

sent, err := client.Emails.Send(&sendping.SendEmailRequest{
    From:    "Acme <hello@yourdomain.com>",
    To:      []string{"user@example.com"},
    Subject: "Hello from SendPing",
    Html:    "<p>Your first email 🎉</p>",
})
```

### Ruby

```bash
gem install sendping
```

```ruby
require "sendping"

SendPing.api_key = "mb_xxxxxxxxx"

sent = SendPing::Emails.send({
  from: "Acme <hello@yourdomain.com>",
  to: ["user@example.com"],
  subject: "Hello from SendPing",
  html: "<p>Your first email 🎉</p>"
})
puts sent["id"]
```

### PHP

```bash
composer require sendping/sendping
```

```php
use SendPing\SendPing;

$sendping = SendPing::client('mb_xxxxxxxxx');

$sent = $sendping->emails->send([
    'from' => 'Acme <hello@yourdomain.com>',
    'to' => ['user@example.com'],
    'subject' => 'Hello from SendPing',
    'html' => '<p>Your first email 🎉</p>',
]);
echo 'sent ' . $sent['id'];
```

### Java

```xml
<dependency>
  <groupId>co.sendping</groupId>
  <artifactId>sendping</artifactId>
  <version>1.0.0</version>
</dependency>
```

```java
SendPing sendping = new SendPing("mb_xxxxxxxxx");

SendEmailRequest request = SendEmailRequest.builder()
        .from("Acme <hello@yourdomain.com>")
        .to("user@example.com")
        .subject("Hello from SendPing")
        .html("<p>Your first email 🎉</p>")
        .build();

SendPingResponse sent = sendping.emails().send(request);
System.out.println("sent " + sent.getString("id"));
```

### .NET

```bash
dotnet add package SendPing
```

```csharp
using SendPing;

ISendPing sendping = SendPingClient.Create("mb_xxxxxxxxx");

var sent = await sendping.EmailSendAsync(new EmailMessage
{
    From = "Acme <hello@yourdomain.com>",
    To = "user@example.com",
    Subject = "Hello from SendPing",
    HtmlBody = "<p>Your first email 🎉</p>",
});
Console.WriteLine($"sent {sent.Id}");
```

### Rust

```bash
cargo add sendping
cargo add tokio -F macros,rt-multi-thread
```

```rust
use sendping::{SendEmailOptions, SendPing, Result};

#[tokio::main]
async fn main() -> Result<()> {
    let sendping = SendPing::new("mb_xxxxxxxxx");

    let email = SendEmailOptions::new(
        "Acme <hello@yourdomain.com>", ["user@example.com"], "Hello from SendPing",
    ).with_html("<p>Your first email 🎉</p>");

    let sent = sendping.emails.send(email).await?;
    println!("sent {}", sent.id);
    Ok(())
}
```

### CLI

```bash
npm i -g sendping-cli
export SENDPING_API_KEY=mb_xxxxxxxxx

sendping emails send \
  --from 'Acme <hello@yourdomain.com>' --to 'user@example.com' \
  --subject 'Hello from SendPing' --html '<p>Your first email 🎉</p>'
```

The CLI covers the full surface — `sendping <resource> <action>` for emails, batches, receiving, domains, contacts, segments, topics, campaigns, templates, automations, webhooks, events, keys, logs, and polls. `sendping --help` lists everything.

## Beyond sending

Each package README documents its full surface: batch sends, scheduling (`scheduled_at`), template sends with variables, inbound email, domain management with DNS records, audiences (contacts/segments/topics), campaigns, automations, API keys, logs, polls — and **webhook signature verification** (Svix-compatible `svix-id`/`svix-timestamp`/`svix-signature` headers with `whsec_…` secrets) so your webhook handlers can trust what they receive.

## Repository layout & contributing

This is the development monorepo for all SDKs — issues and PRs for every language belong here.

- [`shekhu10/sendping-php`](https://github.com/shekhu10/sendping-php) is a **read-only subtree split** of [`sendping-php/`](./sendping-php), regenerated by CI on every release, because Packagist requires `composer.json` at the repository root. Never edit it directly.
- Go consumes this monorepo directly via the `sendping-go/vX.Y.Z` tags.

Releases: tag `vX.Y.Z` here and CI publishes every package (`.github/workflows/release.yml`).

## License

MIT — see the `LICENSE` file in each package.
