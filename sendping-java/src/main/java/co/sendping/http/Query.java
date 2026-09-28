package co.sendping.http;

/** Incrementally builds a {@code ?a=b&c=d} query string; null values are skipped. */
public final class Query {
    private final StringBuilder sb = new StringBuilder();

    public Query add(String name, Object value) {
        if (value == null) return this;
        sb.append(sb.length() == 0 ? '?' : '&')
          .append(name)
          .append('=')
          .append(Urls.encode(String.valueOf(value)));
        return this;
    }

    @Override
    public String toString() { return sb.toString(); }
}
