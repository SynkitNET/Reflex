#include "reflex/ping.hpp"
#include <iostream>
#include <stdexcept>

void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
int main() {
    try {
        reflex::PingOverlay effect;
        check(effect.frames(100, true).empty(), "Idle pings are hidden");
        effect.begin({25, -300}, 100, 2);
        const auto first = effect.frames(130, true);
        check(first.size() == 1 && first[0].mark.drop < -25 && first[0].mark.trail > 0 && first[0].mark.rings.size() == 1, "One trigger starts one falling mark and one outer ring");
        const auto full = effect.frames(500, true);
        check(full.size() == 1 && full[0].origin.x == 25 && full[0].origin.y == -300 && full[0].scale == 2, "A single trigger never generates more marks");
        check(std::abs(full[0].mark.drop) < .01 && full[0].mark.trail == 0 && full[0].mark.rings.size() == 3, "The mark settles before the rings finish contracting");
        check(effect.frames(600, true)[0].mark.rings[0].radius < full[0].mark.rings[0].radius, "Rings contract inward");
        check(effect.frames(1100, true)[0].mark.opacity < 1, "Mark fades out");
        check(effect.frames(1200, true).empty() && !effect.running(), "Ping ends automatically");
        effect.begin({10, 20}, 2000, 1); effect.begin({300, 400}, 2200, 2);
        const auto repeated = effect.frames(2300, true);
        check(repeated.size() == 2 && repeated[0].origin.x == 10 && repeated[1].origin.x == 300 && repeated[0].mark.drop != repeated[1].mark.drop, "Repeated triggers retain independent locations and animation ages");
        check(effect.frames(3100, true).size() == 1 && effect.frames(3100, true)[0].origin.x == 300, "The older ping expires without cancelling the newer one");
        check(effect.frames(3150, false).empty(), "Switching apps clears every ping");
        check(effect.frames(3200, true).empty(), "Returning to Photoshop cannot resurrect old pings");
        effect.begin({}, 4000, 1); effect.clear(); check(effect.frames(4001, true).empty(), "Escape or unload clears the effect");
        effect.begin({}, 4500, 1); check(effect.frames(4499, true).empty(), "Clock reversal clears invalid frames");
        for (int i = 0; i < 100; ++i) effect.begin({static_cast<double>(i), 0}, 5000 + i, 1);
        const auto spam = effect.frames(5500, true);
        check(spam.size() == reflex::PingOverlay::capacity && std::all_of(spam.begin(), spam.end(), [](const auto& frame) { return frame.origin.x >= 88; }), "Rapid input keeps a bounded set of the most recent pings");
        std::cout << "One-ping triggers, falling motion, inward rings, independent repeats, DPI and cleanup passed.\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
