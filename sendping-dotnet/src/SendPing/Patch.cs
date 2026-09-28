using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>
/// A three-state PATCH field.
/// </summary>
/// <remarks>
/// <para>
/// The API's PATCH endpoints key off whether a JSON key is PRESENT: a key that
/// is absent leaves the field untouched, and a key present with an explicit
/// <c>null</c> CLEARS it. A plain <c>string?</c> property can only express two
/// of those three states, because the client omits nulls, so the clearable
/// properties are typed <c>Patch&lt;T&gt;?</c> instead:
/// </para>
/// <list type="bullet">
/// <item><description><c>null</c> — the key is omitted; the server leaves the field alone.</description></item>
/// <item><description><c>Patch.Value(v)</c> (or just <c>v</c>, via the implicit conversion) — the key is sent with <c>v</c>.</description></item>
/// <item><description><c>Patch.Clear&lt;T&gt;()</c> — the key is sent as JSON <c>null</c>; the server clears the field.</description></item>
/// </list>
/// <example>
/// <code>
/// await sendping.TemplateUpdateAsync(id, new TemplateUpdateOptions
/// {
///     Subject = "Your receipt",          // set
///     Alias   = Patch.Clear&lt;string&gt;(),   // cleared server-side
///                                        // Name omitted => unchanged
/// });
/// </code>
/// </example>
/// </remarks>
/// <typeparam name="T">The field's value type.</typeparam>
[JsonConverter(typeof(PatchConverterFactory))]
public readonly struct Patch<T>
{
    private readonly T? _value;

    private Patch(T? value, bool hasValue)
    {
        _value = value;
        HasValue = hasValue;
    }

    /// <summary>True when this field sends a value; false when it clears the field.</summary>
    public bool HasValue { get; }

    /// <summary>True when this field serializes as an explicit JSON <c>null</c>.</summary>
    public bool IsClear => !HasValue;

    /// <summary>The value being sent, or <c>default</c> when this field clears.</summary>
    public T? Value => _value;

    internal static Patch<T> FromValue(T value) => new(value, true);

    internal static Patch<T> Cleared => new(default, false);

    /// <summary>Read the value, returning false when this field clears instead.</summary>
    public bool TryGetValue(out T value)
    {
        value = _value!;
        return HasValue;
    }

    /// <summary>Send <paramref name="value"/> for this field.</summary>
    public static implicit operator Patch<T>(T value) => FromValue(value);

    /// <inheritdoc/>
    public override string ToString() => HasValue ? _value?.ToString() ?? "null" : "<clear>";
}

/// <summary>Factory methods for <see cref="Patch{T}"/> PATCH fields.</summary>
public static class Patch
{
    /// <summary>Send <paramref name="value"/> for this field.</summary>
    public static Patch<T> Value<T>(T value) => Patch<T>.FromValue(value);

    /// <summary>Send an explicit JSON <c>null</c>, clearing the field server-side.</summary>
    public static Patch<T> Clear<T>() => Patch<T>.Cleared;
}

/// <summary>Serializes <see cref="Patch{T}"/> as either its value or JSON <c>null</c>.</summary>
internal sealed class PatchConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert)
        => typeToConvert.IsGenericType && typeToConvert.GetGenericTypeDefinition() == typeof(Patch<>);

    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options)
    {
        var valueType = typeToConvert.GetGenericArguments()[0];
        return (JsonConverter)Activator.CreateInstance(
            typeof(PatchConverter<>).MakeGenericType(valueType))!;
    }
}

internal sealed class PatchConverter<T> : JsonConverter<Patch<T>>
{
    public override Patch<T> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => reader.TokenType == JsonTokenType.Null
            ? Patch.Clear<T>()
            : Patch.Value(JsonSerializer.Deserialize<T>(ref reader, options)!);

    public override void Write(Utf8JsonWriter writer, Patch<T> value, JsonSerializerOptions options)
    {
        if (value.TryGetValue(out var inner) && inner is not null)
        {
            JsonSerializer.Serialize(writer, inner, options);
        }
        else
        {
            writer.WriteNullValue();
        }
    }
}
