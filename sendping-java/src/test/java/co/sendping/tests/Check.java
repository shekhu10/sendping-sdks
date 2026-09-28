package co.sendping.tests;

import java.util.ArrayList;
import java.util.List;

/** Tiny assertion helper for the plain-main test runners (no JUnit). */
public final class Check {
    private static int passed = 0;
    private static final List<String> failures = new ArrayList<>();

    private Check() {}

    public static void eq(String label, Object expected, Object actual) {
        if (expected == null ? actual == null : expected.equals(actual)) {
            pass(label);
        } else {
            fail(label + " — expected <" + expected + "> but was <" + actual + ">");
        }
    }

    public static void isTrue(String label, boolean condition) {
        if (condition) pass(label);
        else fail(label + " — expected true");
    }

    public static void isNull(String label, Object value) {
        if (value == null) pass(label);
        else fail(label + " — expected null but was <" + value + ">");
    }

    public static void contains(String label, String haystack, String needle) {
        if (haystack != null && haystack.contains(needle)) {
            pass(label);
        } else {
            fail(label + " — <" + haystack + "> does not contain <" + needle + ">");
        }
    }

    public static void notContains(String label, String haystack, String needle) {
        if (haystack == null || !haystack.contains(needle)) {
            pass(label);
        } else {
            fail(label + " — <" + haystack + "> unexpectedly contains <" + needle + ">");
        }
    }

    private static void pass(String label) {
        passed++;
        System.out.println("  ok  " + label);
    }

    private static void fail(String label) {
        failures.add(label);
        System.out.println("  FAIL " + label);
    }

    public static void suite(String name) {
        System.out.println("\n== " + name + " ==");
    }

    /** Print the summary and exit non-zero when anything failed. */
    public static void finish() {
        System.out.println();
        System.out.println(passed + " passed, " + failures.size() + " failed");
        if (!failures.isEmpty()) {
            System.out.println("\nFailures:");
            for (String f : failures) System.out.println("  - " + f);
            System.exit(1);
        }
    }
}
