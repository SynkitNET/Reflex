#include "reflex/runtime.hpp"
#include <iostream>
#include <stdexcept>
using namespace reflex;
void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
template<class F> void refuses(F operation) { bool threw = false; try { operation(); } catch (...) { threw = true; } check(threw, "operation should be refused"); }
Snapshot snapshot() {
    Snapshot value; value.session = "session"; value.document = "42";
    value.search = {'K', control | alt}; value.wheel = {'W', control | alt};
    value.slots[0] = "layer.new"; value.suspended = false; return value;
}
int main() {
    try {
        Runtime r; auto s = snapshot();
        check(r.sync(s, {}, 100), "sync");
        check(r.input({'W', true, control | alt, {10, 10}, true, false}, 110, 178), "consume trigger");
        check(r.input({'W', false, control | alt, {10, -190}, true, false}, 120, 178), "consume release");
        auto event = r.poll(130, true); check(event && event->command == "layer.new", "gesture command");
        check(!r.poll(131, true), "at most one delivery");
        check(!r.acknowledge(event->sequence + 1), "foreign acknowledgement");
        check(r.acknowledge(event->sequence), "acknowledgement");
        check(!r.input({'K', true, control | alt, {}, true, true}, 150, 178), "ignore injected key");
        s.suspended = true; r.sync(s, {}, 200);
        auto capture = r.capture("start", "record", "session", 210, true);
        check(capture.phase == "listening", "capture starts suspended");
        check(r.input({'A', true, meta | shift, {}, true, false}, 220, 178), "capture Cmd+Shift+A");
        check(r.capture("read", "record", "session", 221, true).phase == "pressed", "pressed");
        refuses([&] { r.capture("confirm", "record", "session", 222, true); });
        check(r.input({'A', false, meta | shift, {}, true, false}, 230, 178), "suppress captured keyup");
        check(r.capture("read", "record", "session", 231, true).phase == "pressed", "wait for modifier release");
        r.input({0, false, 0, {}, true, false}, 240, 178);
        check(r.capture("read", "record", "session", 241, true).phase == "ready", "released candidate");
        r.sync(s, {}, 250);
        capture = r.capture("confirm", "record", "session", 260, true);
        check(capture.phase == "confirmed" && capture.binding == Binding{'A', meta | shift}, "Mac modifiers preserved");
        refuses([&] { r.capture("confirm", "record", "session", 261, true); });
        r.capture("start", "escape", "session", 270, true);
        r.input({27, true, 0, {}, true, false}, 280, 178);
        check(r.capture("read", "escape", "session", 290, true).phase == "cancelled", "Escape cancels");
        r.input({27, false, 0, {}, true, false}, 291, 178);
        r.capture("start", "focus", "session", 300, true);
        check(r.capture("read", "focus", "session", 310, false).phase == "cancelled", "focus loss cancels");
        r.sync(s, {}, 400); r.capture("start", "document", "session", 410, true);
        s.document = "43"; r.sync(s, {}, 420);
        check(r.capture("read", "document", "session", 430, true).phase == "cancelled", "document changes cancel capture");
        r.capture("start", "expire", "session", 440, true);
        r.sync(s, {}, 30450);
        check(r.capture("read", "expire", "session", 30460, true).phase == "expired", "capture expires");
        s.suspended = false; r.sync(s, {}, 30500);
        refuses([&] { r.capture("start", "unsafe", "session", 30510, true); });
        r.input({'W', true, control | alt, {0,0}, true, false}, 30520, 178);
        check(!r.frame(34000, true, {0,-200}), "stale heartbeat closes wheel");
        check(!r.poll(34001, true), "stale command cannot execute");
        r.stop(); check(!r.input({'K', true, control | alt, {}, true, false}, 34002, 178), "stop releases input");
        std::cout << "Native runtime checks passed\n";
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
