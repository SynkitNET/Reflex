#include "reflex/engine.hpp"
#include "reflex/wheel_layout.hpp"
#include <algorithm>
#include <array>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <stdexcept>

using namespace reflex;
namespace {
int checks = 0;
void check(bool condition, const char* message) {
    ++checks;
    if (!condition) throw std::runtime_error(message);
}
Snapshot example() {
    Snapshot value;
    value.session = "reflex-test-session";
    value.document = "42";
    value.search = {'K', control | alt};
    value.wheel = {'Q', control | alt};
    value.suspended = false;
    for (int i = 0; i < 8; ++i) value.slots[i] = "slot" + std::to_string(i);
    return value;
}
struct Fixture {
    Engine engine;
    Snapshot snapshot = example();
    Time now = 100;
    Point cursor{500, 500};
    unsigned modifiers = control | alt;
    bool foreground = true;
    Fixture() { check(engine.sync(snapshot, now), "valid snapshot"); }
    bool key(int key, bool down) { return engine.input({key, down, modifiers, cursor, foreground}, now); }
    void flick() { check(key('Q', true), "press"); cursor.x += 400; ++now; check(key('Q', false), "release"); }
};
void geometry() {
    for (int count : {4, 8}) {
        check(sector({0, 0}, {0, 0}, 178, count) == -1, "center cancels");
        check(sector({0, -10000}, {0, 0}, 178, count) == 0, "north outside");
        check(sector({10000, 0}, {0, 0}, 178, count) == count / 4, "east outside");
        check(sector({0, 10000}, {0, 0}, 178, count) == count / 2, "south outside");
        check(sector({-10000, 0}, {0, 0}, 178, count) == count * 3 / 4, "west outside");
    }
    check(sector({-900, -900}, {-1000, -1000}, 178, 8) == 3, "negative screen origin");
    check(sector({49, 0}, {0, 0}, 178, 8) == -1, "dead zone");
    check(sector({50, 0}, {0, 0}, 178, 8) == 2, "just outside dead zone");
    check(sector({100, 0}, {0, 0}, 178, 5) == -1, "invalid directions");
    check(sector({100, 0}, {0, 0}, 0, 8) == -1, "invalid radius");
    check(sector({std::numeric_limits<double>::quiet_NaN(), 0}, {0, 0}, 178, 8) == -1, "nan rejected");
}
void wheelLayout() {
    for (int count : {4, 8}) for (int i = 0; i < count; ++i) {
        const auto& box = wheelContent(count, i);
        check(box.width >= 60, "wheel labels retain a readable width");
        for (double x = box.x; x <= box.x + box.width; x += 1) {
            for (double y = box.y; y <= box.y + WheelContent::height; y += 1) {
                check(sector({x, y}, {}, 178, count) == i, "content cannot cross a sector or enter the logo");
                check(std::hypot(x, y) <= 170.001, "content keeps padding from the outer rim");
            }
        }
    }
}
void gestures() {
    Fixture f;
    f.flick();
    f.cursor = {0, 500};
    auto event = f.engine.take(f.now, true);
    check(event && event->command == "slot2", "one millisecond flick without painting uses release position");
    check(!f.engine.take(f.now, true), "single delivery");
    check(!f.key('Q', true), "no overlapping action while awaiting acknowledgment");
    check(!f.engine.acknowledge(event->sequence + 1), "wrong acknowledgment rejected");
    check(f.engine.acknowledge(event->sequence), "matching acknowledgment");
    check(!f.engine.acknowledge(event->sequence), "acknowledgment consumed once");
    check(f.key('Q', true), "next gesture immediately available");
    check(f.key('Q', true), "autorepeat suppressed");
    f.cursor.x -= 400;
    check(f.key('Q', false), "next release");
    event = f.engine.take(f.now, true);
    check(event && event->command == "slot6", "autorepeat preserves origin");
    for (int trigger : std::array<int, 6>{4, 5, 6, 32, 0x70, 'A'}) {
        Fixture mouse;
        mouse.snapshot.wheel = {trigger, 0}; mouse.modifiers = 0;
        check(mouse.engine.sync(mouse.snapshot, mouse.now), "mouse or keyboard binding accepted");
        check(mouse.key(trigger, true), "button press"); mouse.cursor.y -= 400;
        check(mouse.key(trigger, false), "button release");
        const auto choice = mouse.engine.take(mouse.now, true);
        check(choice && choice->command == "slot0", "button flick chooses north");
    }
    std::array<int, 3> order{0xA2, 0xA4, 'Q'};
    std::sort(order.begin(), order.end());
    do {
        Fixture chord;
        check(chord.key('Q', true), "chord press");
        chord.cursor.x += 400;
        for (const int key : order) {
            if (key == 0xA2) chord.modifiers &= ~control;
            if (key == 0xA4) chord.modifiers &= ~alt;
            check(chord.key(key, false) == (key == 'Q'), "only trigger release suppressed");
            chord.cursor.x = 0;
        }
        const auto choice = chord.engine.take(chord.now, true);
        check(choice && choice->command == "slot2", "all chord release orders use first release");
    } while (std::next_permutation(order.begin(), order.end()));
}
void cancellation() {
    for (int reason = 0; reason < 7; ++reason) {
        Fixture f;
        check(f.key('Q', true), "cancellation press");
        if (reason == 0) f.foreground = false;
        if (reason == 1) { f.snapshot.document = "43"; check(f.engine.sync(f.snapshot, f.now), "document change"); }
        if (reason == 2) { f.snapshot.suspended = true; check(f.engine.sync(f.snapshot, f.now), "modal enters"); }
        if (reason == 3) f.now += 3001;
        if (reason == 4) { check(f.key(0x1b, true), "escape consumed"); check(f.key(0x1b, false), "escape release consumed"); }
        if (reason == 5) f.modifiers |= meta;
        if (reason == 6) { f.snapshot.slots[2] = "new-command"; check(f.engine.sync(f.snapshot, f.now), "wheel edited"); }
        f.cursor.x += 400;
        check(f.key('Q', false), "cancelled trigger release still suppressed");
        check(!f.engine.take(f.now, true), "cancelled gesture does not run");
        check(!f.engine.gesture(), "cancelled wheel closes");
    }
    Fixture expired; expired.flick(); expired.now += 2001;
    check(!expired.engine.take(expired.now, true), "stale delivery discarded");
    Fixture center; center.key('Q', true); center.key('Q', false);
    check(!center.engine.take(center.now, true), "center release does not run");
    Fixture empty; empty.snapshot.slots[2].clear(); empty.engine.sync(empty.snapshot, empty.now); empty.flick();
    check(!empty.engine.take(empty.now, true), "empty direction does not run");
    Fixture modal;
    modal.engine.suspend(); check(!modal.key('Q', true), "suspended shortcuts pass through");
    check(modal.engine.sync(modal.snapshot, modal.now), "modal exit update"); modal.flick();
    check(modal.engine.take(modal.now, true).has_value(), "wheel immediately returns after modal exit");
    Fixture fake;
    check(!fake.engine.input({'Q', true, control | alt, {500, 500}, true, true}, fake.now), "synthetic input ignored");
    check(!fake.engine.gesture(), "synthetic input cannot open wheel");
    fake.engine.stop(); check(!fake.key('Q', true), "stopped engine ignores shortcuts");
}
void validation() {
    Fixture f;
    auto invalid = f.snapshot; invalid.wheel = invalid.search;
    check(!f.engine.sync(invalid, f.now), "duplicate bindings rejected");
    invalid = f.snapshot; invalid.wheel.key = 0x7b;
    check(!f.engine.sync(invalid, f.now), "reserved F12 rejected");
    invalid = f.snapshot; invalid.slots[0] = std::string(1025, 'x');
    check(!f.engine.sync(invalid, f.now), "oversize id rejected");
    f.flick(); check(f.engine.take(f.now, true).has_value(), "invalid update does not replace valid snapshot");
    Fixture search; check(search.key('K', true), "search opens on press");
    auto event = search.engine.take(search.now, true);
    check(event && event->kind == EventKind::search, "search event delivered");
    check(search.key('K', true), "search repeat suppressed"); check(search.key('K', false), "search release suppressed");
}
void clickedOverlay() {
    Fixture f;
    check(f.engine.openWheel(f.cursor, f.now, 178, true), "menu opens native overlay");
    check(f.engine.gesture()->clickToChoose, "menu overlay stays open without a held shortcut");
    f.modifiers = 0; f.cursor.y -= 200;
    check(f.key(1, true), "overlay consumes left mouse press instead of painting Photoshop");
    check(f.key(1, false), "overlay consumes release");
    auto event = f.engine.take(f.now, true);
    check(event && event->command == "slot0", "click selects native overlay sector");
    check(f.engine.acknowledge(event->sequence), "click command acknowledges");
    check(!f.key(1, true), "ordinary Photoshop clicks pass through after overlay closes");
    check(f.engine.openWheel(f.cursor, f.now, 178, true), "reopen");
    check(f.key(2, true) && f.key(2, false), "right click cancels without context menu");
    check(!f.engine.gesture() && !f.engine.take(f.now, true), "cancel does not run");
    f.engine.openWheel(f.cursor, f.now, 178, true);
    check(f.key(0x1b, true) && f.key(0x1b, false), "Escape cancels click overlay");
    f.engine.openWheel(f.cursor, f.now, 178, true); f.foreground = false;
    check(!f.key(1, true), "focus loss cancels overlay before clicking another app");
    check(!f.engine.gesture(), "overlay closes on focus loss");
    f.snapshot.suspended = true; f.engine.sync(f.snapshot, f.now);
    check(!f.engine.openWheel(f.cursor, f.now, 178, true), "modal Photoshop refuses overlay");
}
}
int main() {
    try { geometry(); wheelLayout(); gestures(); cancellation(); validation(); clickedOverlay(); }
    catch (const std::exception& error) { std::cerr << "Failed: " << error.what() << '\n'; return EXIT_FAILURE; }
    std::cout << checks << " native engine checks passed\n";
    return EXIT_SUCCESS;
}
