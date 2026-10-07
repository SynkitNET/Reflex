#pragma once
#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_set>

namespace reflex {
using Time = std::int64_t;
enum Modifier : unsigned { control = 1, alt = 2, shift = 4, meta = 8 };
struct Point { double x = 0; double y = 0; };
struct Binding {
    int key = 0;
    unsigned modifiers = 0;
    bool operator==(const Binding&) const = default;
};
struct Snapshot {
    std::string session;
    std::string document;
    Binding search;
    Binding wheel;
    int directions = 8;
    std::array<std::string, 8> slots;
    bool suspended = true;
};
struct Gesture {
    std::uint64_t sequence = 0;
    std::shared_ptr<const Snapshot> snapshot;
    Point origin;
    double radius = 178;
    bool clickToChoose = false;
};
enum class EventKind { search, command };
struct Event {
    std::uint64_t sequence = 0;
    EventKind kind = EventKind::search;
    std::string command;
    std::string session;
    std::string document;
    Time created = 0;
};
struct Input {
    int key = 0;
    bool down = false;
    unsigned modifiers = 0;
    Point cursor;
    bool foreground = false;
    bool injected = false;
};
bool validBinding(Binding binding);
int sector(Point point, Point origin, double radius, int count);

class Engine {
public:
    bool sync(Snapshot value, Time now);
    bool input(const Input& value, Time now, double radius = 178);
    bool openWheel(Point cursor, Time now, double radius, bool foreground);
    void observe(bool foreground, Time now);
    void suspend();
    void stop();
    std::optional<Event> take(Time now, bool foreground);
    bool acknowledge(std::uint64_t sequence);
    const std::optional<Gesture>& gesture() const { return gesture_; }
    bool ready(Time now) const;
private:
    bool sameContext(const Snapshot& value) const;
    bool gestureMatches() const;
    void cancel();
    void finish(Point cursor, Time now);
    void enqueue(EventKind kind, std::string command, Time now, std::uint64_t sequence);
    std::shared_ptr<const Snapshot> snapshot_;
    std::optional<Gesture> gesture_;
    std::optional<Event> pending_;
    std::unordered_set<int> suppressed_;
    std::uint64_t sequence_ = 0;
    std::uint64_t inFlight_ = 0;
    unsigned modifiers_ = 0;
    Time syncedAt_ = 0;
};
}
