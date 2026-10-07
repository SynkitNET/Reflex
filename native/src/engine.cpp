#include "reflex/engine.hpp"
#include <cmath>
#include <numbers>
#include <utility>

namespace reflex {
bool validBinding(Binding binding) {
    const int key = binding.key;
    return binding.modifiers <= 15 && (key == 4 || key == 5 || key == 6 || key == 32 ||
        (key >= 'A' && key <= 'Z') || (key >= '0' && key <= '9') ||
        (key >= 0x70 && key <= 0x87 && key != 0x7b));
}

int sector(Point point, Point origin, double radius, int count) {
    const double dx = point.x - origin.x, dy = point.y - origin.y;
    if (!std::isfinite(dx) || !std::isfinite(dy) || !std::isfinite(radius) || radius <= 0 ||
        (count != 4 && count != 8) || std::hypot(dx, dy) < radius * .28) return -1;
    constexpr double turn = std::numbers::pi * 2;
    const double angle = std::fmod(std::atan2(dy, dx) + std::numbers::pi / 2 + turn, turn);
    return static_cast<int>(std::floor(angle / (turn / count) + .5)) % count;
}

bool Engine::sameContext(const Snapshot& value) const {
    return snapshot_ && value.session == snapshot_->session && value.document == snapshot_->document;
}

bool Engine::gestureMatches() const {
    return gesture_ && sameContext(*gesture_->snapshot) &&
        gesture_->snapshot->wheel == snapshot_->wheel &&
        gesture_->snapshot->directions == snapshot_->directions &&
        gesture_->snapshot->slots == snapshot_->slots;
}

bool Engine::ready(Time now) const {
    return snapshot_ && !snapshot_->suspended && now >= syncedAt_ && now - syncedAt_ <= 3000;
}

bool Engine::sync(Snapshot value, Time now) {
    if (value.session.empty() || value.session.size() > 128 || value.document.size() > 1024 ||
        !validBinding(value.search) || !validBinding(value.wheel) || value.search == value.wheel ||
        (value.directions != 4 && value.directions != 8)) return false;
    for (const auto& slot : value.slots) if (slot.size() > 1024) return false;
    const bool same = sameContext(value);
    const bool sameSession = snapshot_ && snapshot_->session == value.session;
    snapshot_ = std::make_shared<const Snapshot>(std::move(value));
    syncedAt_ = now;
    if (!sameSession) inFlight_ = 0;
    if (!same || snapshot_->suspended) pending_.reset();
    if (!gestureMatches() || snapshot_->suspended) cancel();
    return true;
}

void Engine::cancel() { gesture_.reset(); }

void Engine::observe(bool foreground, Time now) {
    if (!foreground || !ready(now)) {
        cancel();
        pending_.reset();
    }
    if (pending_ && (now < pending_->created || now - pending_->created > 2000)) pending_.reset();
}

void Engine::suspend() {
    cancel();
    pending_.reset();
    if (snapshot_) {
        Snapshot value = *snapshot_;
        value.suspended = true;
        snapshot_ = std::make_shared<const Snapshot>(std::move(value));
    }
}

void Engine::stop() {
    cancel();
    pending_.reset();
    suppressed_.clear();
    snapshot_.reset();
    inFlight_ = 0;
    modifiers_ = 0;
}

void Engine::enqueue(EventKind kind, std::string command, Time now, std::uint64_t sequence) {
    if (!ready(now) || pending_ || inFlight_) return;
    pending_ = Event{sequence, kind, std::move(command), snapshot_->session, snapshot_->document, now};
}

void Engine::finish(Point cursor, Time now) {
    if (!gesture_) return;
    const auto gesture = *gesture_;
    cancel();
    const int index = sector(cursor, gesture.origin, gesture.radius, gesture.snapshot->directions);
    if (index >= 0 && !gesture.snapshot->slots[index].empty())
        enqueue(EventKind::command, gesture.snapshot->slots[index], now, gesture.sequence);
}

bool Engine::openWheel(Point cursor, Time now, double radius, bool foreground) {
    observe(foreground, now);
    if (!foreground || !ready(now) || pending_ || inFlight_ || !std::isfinite(radius) || radius <= 0 ||
        !std::isfinite(cursor.x) || !std::isfinite(cursor.y)) return false;
    gesture_ = Gesture{++sequence_, snapshot_, cursor, radius, true};
    return true;
}

bool Engine::input(const Input& value, Time now, double radius) {
    if (value.injected) return false;
    const unsigned previous = modifiers_;
    modifiers_ = value.modifiers;
    observe(value.foreground, now);
    if (gesture_ && !gesture_->clickToChoose) {
        const unsigned required = gesture_->snapshot->wheel.modifiers;
        if (!gestureMatches() || (value.modifiers & ~required)) cancel();
        else if (!value.down && (previous & required) == required &&
            (value.modifiers & required) != required) finish(value.cursor, now);
        else if ((value.modifiers & required) != required) cancel();
    }
    if (suppressed_.contains(value.key)) {
        if (!value.down) {
            suppressed_.erase(value.key);
            if (gesture_ && ((!gesture_->clickToChoose && value.key == gesture_->snapshot->wheel.key) ||
                (gesture_->clickToChoose && value.key == 1))) finish(value.cursor, now);
        }
        return true;
    }
    if (value.down && value.key == 0x1b && value.foreground && gesture_) {
        suppressed_.insert(value.key);
        cancel();
        return true;
    }
    if (gesture_ && gesture_->clickToChoose && value.down && value.foreground && (value.key == 1 || value.key == 2)) {
        suppressed_.insert(value.key);
        if (value.key == 2) cancel();
        return true;
    }
    if (!value.down || !value.foreground || !ready(now) || pending_ || inFlight_) return false;
    const Binding pressed{value.key, value.modifiers};
    if (pressed == snapshot_->search) {
        cancel();
        suppressed_.insert(value.key);
        enqueue(EventKind::search, {}, now, ++sequence_);
        return true;
    }
    if (pressed == snapshot_->wheel && std::isfinite(radius) && radius > 0 &&
        std::isfinite(value.cursor.x) && std::isfinite(value.cursor.y)) {
        suppressed_.insert(value.key);
        gesture_ = Gesture{++sequence_, snapshot_, value.cursor, radius};
        return true;
    }
    return false;
}

std::optional<Event> Engine::take(Time now, bool foreground) {
    observe(foreground, now);
    if (!pending_ || inFlight_) return std::nullopt;
    auto event = std::move(pending_);
    pending_.reset();
    inFlight_ = event->sequence;
    return event;
}

bool Engine::acknowledge(std::uint64_t sequence) {
    if (!sequence || inFlight_ != sequence) return false;
    inFlight_ = 0;
    return true;
}
}
