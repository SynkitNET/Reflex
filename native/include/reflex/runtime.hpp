#pragma once
#include "reflex/engine.hpp"
#include <mutex>

namespace reflex {
struct Appearance {
    std::array<std::string, 8> labels;
    std::array<std::string, 8> icons;
    unsigned accent = 0xe6e6e6;
    unsigned hover = 0x252525;
    unsigned iconAccent = 0xdedede;
    int typeface = 1;
};
struct WheelFrame {
    Gesture gesture;
    Appearance appearance;
    int selected = -1;
};
struct Capture {
    std::string id;
    std::string session;
    std::string phase = "cancelled";
    Binding binding;
    Time started = 0;
    bool held = false;
};

class Runtime {
public:
    bool sync(Snapshot snapshot, Appearance appearance, Time now);
    bool input(const Input& input, Time now, double radius);
    bool openWheel(Point cursor, Time now, double radius, bool foreground);
    std::optional<WheelFrame> frame(Time now, bool foreground, Point cursor);
    std::optional<Event> poll(Time now, bool foreground);
    bool acknowledge(std::uint64_t sequence);
    Capture capture(const std::string& action, const std::string& id,
        const std::string& session, Time now, bool foreground);
    void stop();
private:
    void observeCapture(Time now, bool foreground);
    std::mutex mutex_;
    Engine engine_;
    Snapshot snapshot_;
    Appearance appearance_;
    Time synced_ = 0;
    Capture capture_;
    std::unordered_set<int> captureSuppressed_;
};
Time clockMs();
Runtime& runtime();

void platformStart();
void platformStop();
bool platformForeground();
const char* platformName();
bool platformOpenWheel();
bool platformMissingPing();
std::string platformError();
}
