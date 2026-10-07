#include "reflex/runtime.hpp"
#include <chrono>
#include <stdexcept>

namespace reflex {
Time clockMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}
Runtime& runtime() { static Runtime instance; return instance; }
bool Runtime::openWheel(Point cursor, Time now, double radius, bool foreground) {
    std::lock_guard lock(mutex_);
    return engine_.openWheel(cursor, now, radius, foreground);
}
bool Runtime::sync(Snapshot snapshot, Appearance appearance, Time now) {
    std::lock_guard lock(mutex_);
    if (!engine_.sync(snapshot, now)) return false;
    if (snapshot.session != snapshot_.session || snapshot.document != snapshot_.document || !snapshot.suspended)
        capture_.phase = "cancelled";
    snapshot_ = std::move(snapshot);
    appearance_ = std::move(appearance);
    synced_ = now;
    return true;
}
void Runtime::observeCapture(Time now, bool foreground) {
    if (capture_.phase != "listening" && capture_.phase != "pressed" && capture_.phase != "ready") return;
    if (now < capture_.started || now - capture_.started > 30000) capture_.phase = "expired";
    else if (!foreground || now < synced_ || now - synced_ > 3000 || !snapshot_.suspended ||
        snapshot_.session != capture_.session) capture_.phase = "cancelled";
}
bool Runtime::input(const Input& input, Time now, double radius) {
    std::lock_guard lock(mutex_);
    if (input.injected) return false;
    observeCapture(now, input.foreground);
    const bool active = capture_.phase == "listening" || capture_.phase == "pressed" || capture_.phase == "ready";
    if (active) {
        if (input.down && input.key == 0x1b) {
            capture_.phase = "cancelled";
            captureSuppressed_.insert(input.key);
        } else if (capture_.phase == "listening" && input.down && validBinding({input.key, input.modifiers})) {
            capture_.binding = {input.key, input.modifiers};
            capture_.phase = "pressed";
            capture_.held = true;
            captureSuppressed_.insert(input.key);
        } else if (capture_.phase == "pressed") {
            if (!input.down && input.key == capture_.binding.key) capture_.held = false;
            if (!capture_.held && !(input.modifiers & capture_.binding.modifiers)) capture_.phase = "ready";
        }
    }
    if (captureSuppressed_.contains(input.key)) {
        if (!input.down) captureSuppressed_.erase(input.key);
        return true;
    }
    return engine_.input(input, now, radius);
}
std::optional<WheelFrame> Runtime::frame(Time now, bool foreground, Point cursor) {
    std::lock_guard lock(mutex_);
    observeCapture(now, foreground);
    engine_.observe(foreground, now);
    if (!engine_.gesture()) return std::nullopt;
    const auto& gesture = *engine_.gesture();
    return WheelFrame{gesture, appearance_, sector(cursor, gesture.origin, gesture.radius, gesture.snapshot->directions)};
}
std::optional<Event> Runtime::poll(Time now, bool foreground) {
    std::lock_guard lock(mutex_);
    observeCapture(now, foreground);
    return engine_.take(now, foreground);
}
bool Runtime::acknowledge(std::uint64_t sequence) {
    std::lock_guard lock(mutex_);
    return engine_.acknowledge(sequence);
}
Capture Runtime::capture(const std::string& action, const std::string& id,
    const std::string& session, Time now, bool foreground) {
    std::lock_guard lock(mutex_);
    observeCapture(now, foreground);
    if (id.empty() || id.size() > 128 || session != snapshot_.session)
        throw std::runtime_error("Shortcut capture session changed. Record again.");
    if (action == "start") {
        if (!foreground || !snapshot_.suspended || now < synced_ || now - synced_ > 3000)
            throw std::runtime_error("Return to Photoshop and record the shortcut again.");
        engine_.suspend();
        capture_ = Capture{id, session, "listening", {}, now, false};
    } else {
        if (id != capture_.id || session != capture_.session)
            throw std::runtime_error("Shortcut capture ended. Record again.");
        if (action == "cancel") capture_.phase = "cancelled";
        else if (action == "confirm") {
            if (capture_.phase != "ready" || !foreground)
                throw std::runtime_error("Release the shortcut before saving, or record it again.");
            Capture result = capture_;
            result.phase = "confirmed";
            capture_.phase = "cancelled";
            return result;
        } else if (action != "read") throw std::runtime_error("Unknown capture action.");
    }
    return capture_;
}
void Runtime::stop() {
    std::lock_guard lock(mutex_);
    engine_.stop();
    snapshot_ = {};
    capture_ = {};
    captureSuppressed_.clear();
}
}
