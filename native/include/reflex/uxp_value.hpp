#pragma once
#include "UxpAddon.h"
#include "UxpValue.h"
#include <stdexcept>
#include <vector>

namespace reflex {
inline void sdkCheck(addon_status status, const char* operation) {
    if (status != addon_ok)
        throw std::runtime_error(std::string(operation) + " failed (Adobe status " + std::to_string(status) + ").");
}
inline std::string readString(addon_env env, addon_value value) {
    std::size_t size = 0;
    sdkCheck(UxpAddonApis.uxp_addon_get_value_string_utf8(env, value, nullptr, 0, &size), "Read string length");
    if (size > 4096) throw std::runtime_error("Reflex string exceeds the input limit.");
    std::vector<char> bytes(size + 1);
    std::size_t written = 0;
    sdkCheck(UxpAddonApis.uxp_addon_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &written), "Read string");
    return std::string(bytes.data(), written);
}

inline Value readValue(addon_env env, addon_value value, unsigned depth = 0) {
    if (depth > 8) throw std::runtime_error("Reflex input is nested too deeply.");
    addon_valuetype type = addon_undefined;
    sdkCheck(UxpAddonApis.uxp_addon_typeof(env, value, &type), "Read value type");
    switch (type) {
    case addon_undefined: return Value();
    case addon_string: return Value(readString(env, value));
    case addon_boolean: {
        bool result = false;
        sdkCheck(UxpAddonApis.uxp_addon_get_value_bool(env, value, &result), "Read boolean");
        return Value(result);
    }
    case addon_number: {
        double result = 0;
        sdkCheck(UxpAddonApis.uxp_addon_get_value_double(env, value, &result), "Read number");
        return Value(result);
    }
    case addon_object: {
        bool array = false;
        sdkCheck(UxpAddonApis.uxp_addon_is_array(env, value, &array), "Identify array");
        if (array) {
            std::uint32_t count = 0;
            sdkCheck(UxpAddonApis.uxp_addon_get_array_length(env, value, &count), "Read array length");
            if (count > 64) throw std::runtime_error("Reflex array exceeds the input limit.");
            Value result(Value::Kind::list);
            for (std::uint32_t i = 0; i < count; ++i) {
                addon_value entry = nullptr;
                sdkCheck(UxpAddonApis.uxp_addon_get_element(env, value, i, &entry), "Read array element");
                result.GetList().push_back(readValue(env, entry, depth + 1));
            }
            return result;
        }
        addon_value keys = nullptr;
        sdkCheck(UxpAddonApis.uxp_addon_get_property_names(env, value, &keys), "Read object keys");
        std::uint32_t count = 0;
        sdkCheck(UxpAddonApis.uxp_addon_get_array_length(env, keys, &count), "Read object size");
        if (count > 64) throw std::runtime_error("Reflex object exceeds the input limit.");
        Value result(Value::Kind::map);
        for (std::uint32_t i = 0; i < count; ++i) {
            addon_value key = nullptr, stringKey = nullptr, entry = nullptr;
            sdkCheck(UxpAddonApis.uxp_addon_get_element(env, keys, i, &key), "Read object key");
            sdkCheck(UxpAddonApis.uxp_addon_coerce_to_string(env, key, &stringKey), "Read object key text");
            sdkCheck(UxpAddonApis.uxp_addon_get_property(env, value, key, &entry), "Read object property");
            result.GetMap().emplace(readString(env, stringKey), readValue(env, entry, depth + 1));
        }
        return result;
    }
    default: throw std::runtime_error("Unsupported value in Reflex native input.");
    }
}
}
