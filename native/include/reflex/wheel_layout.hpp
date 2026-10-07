#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>

namespace reflex {
struct WheelContent {
    double x = 0, y = 0, width = 0;
    static constexpr double height = 58, labelTop = 28, labelHeight = 30, fontSize = 12;
};
inline std::array<WheelContent, 8> makeWheelLayout(int count) {
    std::array<WheelContent, 8> result{};
    const double half = std::numbers::pi / count;
    for (int i = 0; i < count; ++i) {
        const double angle = -std::numbers::pi / 2 + i * 2 * half;
        const double c = std::cos(angle), s = std::sin(angle);
        for (double width = count == 8 ? 100 : 128; width >= 40 && result[i].width == 0; width -= 2) {
            double best = 1000;
            for (double radius = 90; radius <= 158; ++radius) {
                const double x = radius * c, y = radius * s;
                bool fits = true;
                for (double dx : {-width / 2, width / 2}) for (double dy : {-WheelContent::height / 2, WheelContent::height / 2}) {
                    const double px = x + dx, py = y + dy;
                    const double along = px * c + py * s, across = -px * s + py * c;
                    fits = fits && std::hypot(px, py) <= 170 && along * std::sin(half) - std::abs(across) * std::cos(half) >= 6;
                }
                const double nearX = std::max(0.0, std::abs(x) - width / 2);
                const double nearY = std::max(0.0, std::abs(y) - WheelContent::height / 2);
                if (fits && std::hypot(nearX, nearY) >= 58 && std::abs(radius - 123) < best) {
                    best = std::abs(radius - 123);
                    result[i] = {x - width / 2, y - WheelContent::height / 2, width};
                }
            }
        }
    }
    return result;
}
inline const WheelContent& wheelContent(int count, int index) {
    static const auto four = makeWheelLayout(4), eight = makeWheelLayout(8);
    return count == 4 ? four[std::clamp(index, 0, 3)] : eight[std::clamp(index, 0, 7)];
}
}
