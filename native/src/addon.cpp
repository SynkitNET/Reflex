#include "reflex/runtime.hpp"
#include "reflex/uxp_value.hpp"
#include "UxpAddon.h"
#include "UxpValue.h"
#include <cmath>
#include <stdexcept>

namespace {
const Value& field(const Value& value, const char* key) { return value.GetMap().at(key); }
std::string text(const Value& value, std::size_t max = 1024) {
    auto result = value.GetString();
    if (result.size() > max) throw std::runtime_error("Reflex input is too long.");
    return result;
}
int integer(const Value& value, int max) {
    const double number = value.GetNumber();
    if (!std::isfinite(number) || number < 0 || number > max || number != std::floor(number))
        throw std::runtime_error("Invalid Reflex number.");
    return static_cast<int>(number);
}
reflex::Binding binding(const Value& value) {
    return {integer(field(value, "key"), 255), static_cast<unsigned>(integer(field(value, "modifiers"), 15))};
}
Value object() { return Value(Value::Kind::map); }
void put(Value& target, const char* key, Value value) { target.GetMap().emplace(key, std::move(value)); }
void put(Value& target, const char* key, const std::string& value) { put(target, key, Value(value)); }
Value dispatch(const std::string& method, const Value& body) {
    using namespace reflex;
    const auto now = clockMs();
    if (method == "health") {
        platformStart();
        auto result = object();
        put(result, "protocol", Value(1.0));
        put(result, "platform", std::string(platformName()));
        put(result, "version", std::string("0.6.7"));
        return result;
    }
    if (method == "stop") { runtime().stop(); platformStop(); return Value(true); }
    if (method == "suspend") { runtime().stop(); return Value(true); }
    if (method == "wheel") {
        if (!platformOpenWheel()) throw std::runtime_error("Return to Photoshop to open the wheel.");
        return Value(true);
    }
    if (method == "ping") {
        if (!platformMissingPing()) throw std::runtime_error("Return to Photoshop to use Missing ping.");
        return Value(true);
    }
    if (method == "status") {
        auto result = object(); put(result, "error", platformError()); return result;
    }
    if (method == "sync") {
        Snapshot snapshot;
        snapshot.session = text(field(body, "session"), 128);
        snapshot.document = text(field(body, "document"));
        snapshot.search = binding(field(body, "search"));
        snapshot.wheel = binding(field(body, "wheel"));
        snapshot.directions = integer(field(body, "directions"), 8);
        snapshot.suspended = field(body, "suspended").GetBoolean();
        Appearance appearance;
        appearance.accent = static_cast<unsigned>(integer(field(body, "accent"), 0xffffff));
        if (body.GetMap().count("hover")) appearance.hover = static_cast<unsigned>(integer(field(body, "hover"), 0xffffff));
        if (body.GetMap().count("iconAccent")) appearance.iconAccent = static_cast<unsigned>(integer(field(body, "iconAccent"), 0xffffff));
        if (body.GetMap().count("typeface")) appearance.typeface = integer(field(body, "typeface"), 2);
        const auto& slots = field(body, "slots").GetList();
        if (slots.size() != 8) throw std::runtime_error("Reflex requires eight stored slots.");
        for (std::size_t i = 0; i < slots.size(); ++i) {
            snapshot.slots[i] = text(field(slots[i], "id"));
            appearance.labels[i] = text(field(slots[i], "title"), 256);
            appearance.icons[i] = text(field(slots[i], "icon"), 64);
        }
        if (!runtime().sync(std::move(snapshot), std::move(appearance), now))
            throw std::runtime_error("Reflex rejected its shortcut settings.");
        return Value(true);
    }
    if (method == "poll") {
        auto result = object();
        const auto event = runtime().poll(now, platformForeground());
        if (event) {
            put(result, "sequence", Value(static_cast<double>(event->sequence)));
            put(result, "kind", std::string(event->kind == EventKind::search ? "search" : "command"));
            put(result, "command", event->command);
            put(result, "session", event->session);
            put(result, "document", event->document);
            put(result, "age", Value(static_cast<double>(now - event->created)));
        }
        return result;
    }
    if (method == "ack") {
        const double seq = field(body, "sequence").GetNumber();
        if (!std::isfinite(seq) || seq < 1 || seq > 9007199254740991.0 || seq != std::floor(seq))
            throw std::runtime_error("Invalid Reflex acknowledgement.");
        return Value(runtime().acknowledge(static_cast<std::uint64_t>(seq)));
    }
    if (method == "capture") {
        const auto capture = runtime().capture(text(field(body, "action"), 16), text(field(body, "id"), 128),
            text(field(body, "session"), 128), now, platformForeground());
        auto result = object();
        put(result, "id", capture.id);
        put(result, "phase", capture.phase);
        if (capture.phase == "pressed" || capture.phase == "ready" || capture.phase == "confirmed") {
            auto candidate = object();
            put(candidate, "key", Value(static_cast<double>(capture.binding.key)));
            put(candidate, "modifiers", Value(static_cast<double>(capture.binding.modifiers)));
            put(result, "binding", std::move(candidate));
        }
        return result;
    }
    throw std::runtime_error("Unknown Reflex native operation.");
}
addon_value call(addon_env env, addon_callback_info info) {
    std::string operation = "arguments";
    try {
        addon_value args[2]{};
        size_t argc = 2;
        reflex::sdkCheck(UxpAddonApis.uxp_addon_get_cb_info(env, info, &argc, args, nullptr, nullptr), "Read callback arguments");
        if (argc != 2) throw std::runtime_error("Reflex call needs a method and payload.");
        operation = text(reflex::readValue(env, args[0]), 16);
        auto body = reflex::readValue(env, args[1]);
        return dispatch(operation, body).Convert(env);
    } catch (const std::exception& error) {
        const std::string message = "Reflex " + operation + ": " + error.what();
        UxpAddonApis.uxp_addon_throw_error(env, nullptr, message.c_str());
    } catch (const char* error) {
        const addon_extended_error_info* details = nullptr;
        UxpAddonApis.uxp_addon_get_last_error_info(env, &details);
        const std::string message = "Reflex " + operation + ": " + error +
            (details && details->error_message ? std::string(" (") + details->error_message + ")" : "");
        UxpAddonApis.uxp_addon_throw_error(env, nullptr, message.c_str());
    } catch (...) {
        const std::string message = "Reflex " + operation + ": unexpected native error.";
        UxpAddonApis.uxp_addon_throw_error(env, nullptr, message.c_str());
    }
    return nullptr;
}
addon_value init(addon_env env, addon_value exports, const addon_apis& apis) {
    addon_value fn = nullptr;
    reflex::sdkCheck(apis.uxp_addon_create_function(env, "call", 4, call, nullptr, &fn), "Export native function");
    reflex::sdkCheck(apis.uxp_addon_set_named_property(env, exports, "call", fn), "Register native function");
    return exports;
}
void terminate(addon_env) { reflex::platformStop(); reflex::runtime().stop(); }
}
UXP_ADDON_INIT(init)
UXP_ADDON_TERMINATE(terminate)
