#pragma once
#include "reflex/engine.hpp"
#include <algorithm>
#include <cmath>
#include <vector>

namespace reflex {
struct PingRing { double radius, opacity, rotation, width; };
struct PingMark {
    double x, y, drop, opacity, trail;
    std::vector<PingRing> rings;
};
struct PingFrame {
    Point origin;
    double scale;
    PingMark mark;
    std::size_t slot;
};
class PingOverlay {
public:
    static constexpr int drawingSize = 200;
    static constexpr double artworkScale = 1.2;
    static constexpr int size = static_cast<int>(drawingSize * artworkScale);
    static constexpr std::size_t capacity = 12;
    static constexpr Time lifetime = 1100;
    void begin(Point origin, Time now, double scale) {
        pings_[next_] = Ping{origin, now, std::clamp(scale, .5, 4.0)};
        next_ = (next_ + 1) % capacity;
    }
    void clear() { for (auto& ping : pings_) ping.reset(); }
    bool running() const { return std::any_of(pings_.begin(), pings_.end(), [](const auto& ping) { return ping.has_value(); }); }
    std::vector<PingFrame> frames(Time now, bool foreground) {
        if (!foreground) clear();
        std::vector<PingFrame> result;
        for (std::size_t slot = 0; slot < pings_.size(); ++slot) {
            auto& ping = pings_[slot];
            if (!ping) continue;
            const auto age = now - ping->started;
            if (age < 0 || age >= lifetime) { ping.reset(); continue; }
            const double fall = std::min(age / 160.0, 1.0);
            const double settle = std::clamp((age - 160) / 120.0, 0.0, 1.0);
            const double drop = -32 * (1 - fall * fall) - 3 * std::sin(settle * 3.141592653589793);
            const double opacity = std::min(age / 30.0, 1.0) * std::clamp((lifetime - age) / 300.0, 0.0, 1.0);
            PingMark mark{drawingSize / 2.0, drawingSize / 2.0, drop, opacity, std::clamp((160 - age) / 160.0, 0.0, 1.0), {}};
            for (int i = 0; i < 3; ++i) {
                const auto ringAge = age - (i == 0 ? 0 : 150 + (i - 1) * 85);
                if (ringAge < 0 || ringAge >= 620) continue;
                const double progress = ringAge / 620.0;
                const double fade = std::min(ringAge / 40.0, 1.0) * std::clamp((620 - ringAge) / 190.0, 0.0, 1.0);
                mark.rings.push_back({45 * (1 - .78 * progress), fade * opacity, i * 70 + ringAge * .1, 1.3 + .4 * (1 - progress)});
            }
            result.push_back({ping->origin, ping->scale, std::move(mark), slot});
        }
        return result;
    }
private:
    struct Ping { Point origin; Time started; double scale; };
    std::array<std::optional<Ping>, capacity> pings_{};
    std::size_t next_ = 0;
};
}
