

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "reflex/windows_overlay.hpp"
#include <future>
#include <iostream>
#include <stdexcept>
#include <thread>

void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
int main() {
    HWND host = nullptr, secondHost = nullptr;
    int result = 0;
    try {
        host = CreateWindowExW(0, L"STATIC", L"Reflex test host", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, nullptr, nullptr);
        secondHost = CreateWindowExW(0, L"STATIC", L"Reflex test host 2", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, nullptr, nullptr);
        require(host && secondHost, "Could not create hidden test hosts");
        const auto foreground = GetForegroundWindow();
        std::promise<int> completed;
        auto future = completed.get_future();
        std::thread overlayThread([&, done = std::move(completed)]() mutable {
            HWND overlay = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT,
                L"STATIC", L"Reflex hidden test overlay", WS_POPUP, 0, 0, 360, 360, nullptr, nullptr, nullptr, nullptr);
            int status = 0;
            try {
                require(overlay != nullptr, "Could not create hidden overlay");
                require(reflex::windowsOverlay::keepAboveHost(overlay, host).empty(), "Could not attach/raise cross-thread overlay");
                require(GetWindow(overlay, GW_OWNER) == host, "Overlay has no Photoshop owner");
                require((GetWindowLongPtrW(overlay, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0, "Overlay is not topmost");
                require((GetWindowLongPtrW(host, GWL_EXSTYLE) & WS_EX_TOPMOST) == 0, "Promoted the host too");
                require(!IsWindowVisible(overlay) && GetForegroundWindow() == foreground, "Order repair showed or activated a window");

                require(SetWindowPos(overlay, HWND_NOTOPMOST, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER) != FALSE, "Could not reproduce demotion");
                require((GetWindowLongPtrW(overlay, GWL_EXSTYLE) & WS_EX_TOPMOST) == 0, "Demotion was not applied");
                require(reflex::windowsOverlay::keepAboveHost(overlay, host).empty(), "Demoted overlay was not repaired");
                require((GetWindowLongPtrW(overlay, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0, "Repair left the overlay behind");
                require(reflex::windowsOverlay::keepAboveHost(overlay, secondHost).empty(), "Could not follow a different host window");
                require(GetWindow(overlay, GW_OWNER) == secondHost, "Owner did not follow the new host");
                require(!reflex::windowsOverlay::keepAboveHost(overlay, nullptr).empty(), "Accepted a missing host");
                require(!reflex::windowsOverlay::keepAboveHost(overlay, overlay).empty(), "Accepted self ownership");
                require(!IsWindowVisible(overlay) && GetForegroundWindow() == foreground, "Repair stole focus");
            } catch (const std::exception& error) { std::cerr << error.what() << '\n'; status = 1; }
            if (overlay) DestroyWindow(overlay);
            done.set_value(status);
        });

        while (future.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready) {
            MSG message{};
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) DispatchMessageW(&message);
            MsgWaitForMultipleObjectsEx(0, nullptr, 10, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        }
        result = future.get(); overlayThread.join();
        if (!result) std::cout << "Hidden cross-thread overlay ownership and demotion recovery pass without showing or focusing windows.\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; result = 1; }
    if (secondHost) DestroyWindow(secondHost);
    if (host) DestroyWindow(host);
    return result;
}
