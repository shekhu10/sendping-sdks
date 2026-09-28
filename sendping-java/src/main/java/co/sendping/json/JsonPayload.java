package co.sendping.json;

import java.util.Map;

/**
 * Implemented by every request object in the SDK. {@link Json#write(Object)}
 * serializes any {@code JsonPayload} by serializing its {@link #toMap()} view,
 * so request builders only need to maintain an ordered field map.
 */
public interface JsonPayload {
    Map<String, Object> toMap();
}
