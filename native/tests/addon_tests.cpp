#include "reflex/runtime.hpp"
#include "UxpAddon.h"
#include <algorithm>
#include <cstring>
#include <iostream>
#include <map>
#include <memory>
#include <stdexcept>
#include <vector>

struct addon_value__ {
    addon_valuetype type = addon_object;
    bool array = false, boolean = false;
    double number = 0;
    std::string string;
    std::map<std::string, addon_value> fields;
    std::vector<addon_value> elements;
    addon_callback callback = nullptr;
};
struct addon_callback_info__ { std::vector<addon_value> args; };
std::vector<std::unique_ptr<addon_value__>> values;
std::string thrown;
bool started = false;
namespace reflex {
void platformStart() { started = true; }
void platformStop() { started = false; }
bool platformForeground() { return true; }
const char* platformName() { return "win32"; }
bool platformOpenWheel() { return runtime().openWheel({}, clockMs(), 178, true); }
bool platformMissingPing() { return started; }
std::string platformError() { return ""; }
}
addon_value make(addon_valuetype type = addon_object) {
    values.push_back(std::make_unique<addon_value__>()); values.back()->type = type; return values.back().get();
}
addon_value string(std::string text) { auto value = make(addon_string); value->string = std::move(text); return value; }
addon_value number(double number) { auto value = make(addon_number); value->number = number; return value; }
addon_value boolean(bool boolean) { auto value = make(addon_boolean); value->boolean = boolean; return value; }
addon_value array() { auto value = make(); value->array = true; return value; }
void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
addon_apis apis() {
    addon_apis api{};
    api.uxp_addon_get_cb_info = [](addon_env, addon_callback_info info, std::size_t* count, addon_value* args, addon_value*, void**) {
        const auto copied = std::min(*count, info->args.size()); std::copy_n(info->args.begin(), copied, args); *count = info->args.size(); return addon_ok;
    };
    api.uxp_addon_throw_error = [](addon_env, const char*, const char* message) { thrown = message; return addon_ok; };
    api.uxp_addon_get_last_error_info = [](addon_env, const addon_extended_error_info** result) { *result = nullptr; return addon_ok; };
    api.uxp_addon_create_function = [](addon_env, const char*, std::size_t, addon_callback callback, void*, addon_value* result) {
        *result = make(addon_function); (*result)->callback = callback; return addon_ok;
    };
    api.uxp_addon_set_named_property = [](addon_env, addon_value object, const char* key, addon_value value) { object->fields[key] = value; return addon_ok; };
    api.uxp_addon_typeof = [](addon_env, addon_value value, addon_valuetype* result) { *result = value->type; return addon_ok; };
    api.uxp_addon_is_array = [](addon_env, addon_value value, bool* result) { *result = value->array; return addon_ok; };
    api.uxp_addon_get_array_length = [](addon_env, addon_value value, std::uint32_t* result) {
        if (!value->array) return addon_array_expected; *result = static_cast<std::uint32_t>(value->elements.size()); return addon_ok;
    };
    api.uxp_addon_get_element = [](addon_env, addon_value value, std::uint32_t i, addon_value* result) {
        *result = value->elements.at(i); return addon_ok;
    };
    api.uxp_addon_set_element = [](addon_env, addon_value value, std::uint32_t i, addon_value entry) {
        value->elements.resize(std::max(value->elements.size(), static_cast<std::size_t>(i) + 1)); value->elements[i] = entry; return addon_ok;
    };
    api.uxp_addon_get_property_names = [](addon_env, addon_value value, addon_value* result) {
        *result = array();

        if (value->array) for (std::size_t i = 0; i < value->elements.size(); ++i) (*result)->elements.push_back(number(static_cast<double>(i)));
        else for (const auto& [key, entry] : value->fields) { (void)entry; (*result)->elements.push_back(string(key)); }
        return addon_ok;
    };
    api.uxp_addon_coerce_to_string = [](addon_env, addon_value value, addon_value* result) {
        *result = value->type == addon_string ? value : string(std::to_string(static_cast<int>(value->number))); return addon_ok;
    };
    api.uxp_addon_get_property = [](addon_env, addon_value value, addon_value key, addon_value* result) {
        *result = value->array ? value->elements.at(static_cast<std::size_t>(key->number)) : value->fields.at(key->string); return addon_ok;
    };
    api.uxp_addon_set_property = [](addon_env, addon_value value, addon_value key, addon_value entry) { value->fields[key->string] = entry; return addon_ok; };
    api.uxp_addon_get_value_string_utf8 = [](addon_env, addon_value value, char* bytes, std::size_t size, std::size_t* count) {
        if (value->type != addon_string) return addon_string_expected;
        *count = bytes && size ? std::min(value->string.size(), size - 1) : value->string.size();
        if (bytes && size) { std::memcpy(bytes, value->string.data(), *count); bytes[*count] = 0; } return addon_ok;
    };
    api.uxp_addon_get_value_bool = [](addon_env, addon_value value, bool* result) {
        if (value->type != addon_boolean) return addon_boolean_expected; *result = value->boolean; return addon_ok;
    };
    api.uxp_addon_get_value_double = [](addon_env, addon_value value, double* result) {
        if (value->type != addon_number) return addon_number_expected; *result = value->number; return addon_ok;
    };
    api.uxp_addon_get_undefined = [](addon_env, addon_value* result) { *result = make(addon_undefined); return addon_ok; };
    api.uxp_addon_get_boolean = [](addon_env, bool value, addon_value* result) { *result = boolean(value); return addon_ok; };
    api.uxp_addon_create_double = [](addon_env, double value, addon_value* result) { *result = number(value); return addon_ok; };
    api.uxp_addon_create_string_utf8 = [](addon_env, const char* value, std::size_t length, addon_value* result) { *result = string(std::string(value, length)); return addon_ok; };
    api.uxp_addon_create_object = [](addon_env, addon_value* result) { *result = make(); return addon_ok; };
    api.uxp_addon_create_array = [](addon_env, addon_value* result) { *result = array(); return addon_ok; };
    return api;
}
int main() {
    try {
        auto exports = ADDON_INITIALIZER(nullptr, make(), apis());
        const auto invoke = [&](const char* operation, addon_value payload) {
            thrown.clear(); addon_callback_info__ info{{string(operation), payload}};
            return exports->fields.at("call")->callback(nullptr, &info);
        };
        const auto health = invoke("health", make());
        check(health && health->fields.at("protocol")->number == 1 && started, "health reaches platform and returns JS object");
        auto payload = make(), search = make(), wheel = make(), slots = array();
        search->fields = {{"key", number(75)}, {"modifiers", number(3)}};
        wheel->fields = {{"key", number(87)}, {"modifiers", number(3)}};
        for (int i = 0; i < 8; ++i) {
            auto slot = make(); slot->fields = {{"id", string("layer.new")}, {"title", string("New layer")}, {"icon", string("layer-new")}};
            slots->elements.push_back(slot);
        }
        payload->fields = {{"session", string("test")}, {"document", string("42")}, {"search", search}, {"wheel", wheel},
            {"slots", slots}, {"directions", number(8)}, {"suspended", boolean(false)}, {"accent", number(0xb5abfa)}};
        auto synced = invoke("sync", payload);
        check(synced && synced->boolean && thrown.empty(), "JS object containing the 8-slot array must synchronize");
        const auto now = reflex::clockMs();
        reflex::runtime().input({87, true, 3, {}, true, false}, now, 178);
        reflex::runtime().input({87, false, 3, {0, -200}, true, false}, now, 178);
        const auto event = invoke("poll", make());
        check(event && event->fields.at("command")->string == "layer.new", "native gesture makes a JS command event");
        auto ack = make(); ack->fields["sequence"] = event->fields.at("sequence");
        check(invoke("ack", ack)->boolean, "ack succeeds through actual callback");
        check(invoke("poll", make())->fields.empty(), "idle poll returns empty JS object");
        check(invoke("ping", make())->boolean && thrown.empty(), "ping dispatch reaches the native overlay");
        payload->fields["slots"] = make();
        check(!invoke("sync", payload) && thrown.find("Reflex sync: Incorrect value kind") != std::string::npos, "invalid slot type has an operation-specific error");
        slots->elements.resize(65, slots->elements[0]); payload->fields["slots"] = slots;
        check(!invoke("sync", payload) && thrown.find("array exceeds") != std::string::npos, "oversized input is rejected before copying");
        check(invoke("stop", make())->boolean && !started, "stop reaches platform cleanup");
        check(!invoke("ping", make()) && thrown.find("Return to Photoshop") != std::string::npos, "stopped ping cannot succeed");
        ADDON_TERMINATE(nullptr);
        std::cout << "Native addon ABI, array conversion, dispatch and diagnostics passed.\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << " Native error: " << thrown << '\n'; return 1; }
}
