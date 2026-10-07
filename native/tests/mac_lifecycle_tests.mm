#import <AppKit/AppKit.h>
#include "reflex/runtime.hpp"
#include <iostream>
#include <stdexcept>

void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

int main() {
    @autoreleasepool {
        try {
            check(!reflex::platformOpenWheel(), "Wheel before startup must be refused");
            check(!reflex::platformMissingPing(), "Ping before startup must be refused");
            for (int i = 0; i < 2; ++i) {
                reflex::runtime().stop();
                reflex::platformStop();
                check(!reflex::platformOpenWheel(), "Wheel after stop must be refused");
                check(!reflex::platformMissingPing(), "Ping after stop must be refused");
                check(!reflex::platformForeground(), "Stopped adapter must not report foreground");
            }
            std::cout << "Mac pre-start wheel/ping, repeated stop and stopped overlay checks passed.\n";
            return 0;
        } catch (const std::exception& error) {
            std::cerr << error.what() << '\n';
            return 1;
        }
    }
}
