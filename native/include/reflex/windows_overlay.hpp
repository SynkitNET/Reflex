#pragma once
#include <windows.h>
#include <string>

namespace reflex::windowsOverlay {
inline std::string attachOwner(HWND overlay, HWND host) {
    DWORD hostProcess = 0, overlayProcess = 0;
    GetWindowThreadProcessId(host, &hostProcess);
    GetWindowThreadProcessId(overlay, &overlayProcess);
    if (!host || host == overlay || hostProcess != GetCurrentProcessId() || overlayProcess != hostProcess)
        return "Return to Photoshop before opening the wheel.";
    if (GetWindow(overlay, GW_OWNER) == host) return {};
    SetLastError(0);
    if (!SetWindowLongPtrW(overlay, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(host)) && GetLastError())
        return "Windows could not attach the wheel to Photoshop.";
    if (GetWindow(overlay, GW_OWNER) != host)
        return "Windows did not attach the wheel to Photoshop.";
    return {};
}

inline bool hostWindowAbove(HWND overlay) {

    HWND above = GetWindow(overlay, GW_HWNDPREV);
    for (unsigned count = 0; above && count < 256; ++count, above = GetWindow(above, GW_HWNDPREV)) {
        DWORD process = 0;
        GetWindowThreadProcessId(above, &process);
        if (process == GetCurrentProcessId() && IsWindowVisible(above)) return true;
    }
    return false;
}

inline std::string keepAboveHost(HWND overlay, HWND host) {
    if (auto error = attachOwner(overlay, host); !error.empty()) return error;
    if ((GetWindowLongPtrW(overlay, GWL_EXSTYLE) & WS_EX_TOPMOST) && !hostWindowAbove(overlay)) return {};

    if (!SetWindowPos(overlay, HWND_TOPMOST, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER))
        return "Windows could not bring the wheel above Photoshop.";

    if (!(GetWindowLongPtrW(overlay, GWL_EXSTYLE) & WS_EX_TOPMOST) || hostWindowAbove(overlay))
        return "The wheel is still behind Photoshop. Reload Reflex and try again.";
    return {};
}
}
