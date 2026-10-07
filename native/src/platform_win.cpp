#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <objidl.h>
#include <gdiplus.h>
#include "reflex/runtime.hpp"
#include "reflex/icons.hpp"
#include "reflex/windows_overlay.hpp"
#include "reflex/ping.hpp"
#include "reflex/wheel_layout.hpp"
#include <algorithm>
#include <cmath>
#include <future>
#include <numbers>
#include <thread>
#include <atomic>

namespace reflex {
namespace {
std::thread worker;
DWORD workerId = 0;
HWND wheelWindow = nullptr;
std::array<HWND, PingOverlay::capacity> pingWindows{};
PingOverlay pingOverlay;
HHOOK keyboardHook = nullptr, mouseHook = nullptr;
HINSTANCE moduleInstance = nullptr;
ULONG_PTR gdiplusToken = 0;
std::uint64_t paintedSequence = 0;
int paintedSector = -2;
constexpr UINT refreshMessage = WM_APP + 1, openWheelMessage = WM_APP + 2, pingMessage = WM_APP + 3;
std::atomic<bool> refreshQueued{false}, wheelShown{false};
std::mutex errorMutex;
std::string overlayError;
void setOverlayError(std::string error) { std::lock_guard lock(errorMutex); overlayError = std::move(error); }
void requestPaint() {
    if (wheelWindow && !refreshQueued.exchange(true)) {
        if (!PostMessageW(wheelWindow, refreshMessage, 0, 0)) {
            const auto error = GetLastError(); refreshQueued = false;
            setOverlayError("Windows could not schedule the overlay (Windows " + std::to_string(error) + ").");
        }
    }
}
std::wstring wide(const std::string& value) {
    const int count = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    std::wstring result(static_cast<std::size_t>(count), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), count);
    return result;
}
Point cursorPoint() { POINT point{}; GetCursorPos(&point); return {static_cast<double>(point.x), static_cast<double>(point.y)}; }
double scale() { const UINT dpi = GetDpiForWindow(GetForegroundWindow()); return dpi ? dpi / 96.0 : 1.0; }
void drawIcon(Gdiplus::Graphics& g, const std::string& name, float x, float y, float s, Gdiplus::Color accent, bool enabled) {
    using namespace Gdiplus;
    const auto& icons = sharedIcons();
    const auto found = icons.find(name);
    const auto& drawing = found == icons.end() ? icons.at("play") : found->second;
    for (const auto& stroke : drawing) {
        GraphicsPath path(FillModeAlternate);
        for (const auto& contour : stroke.contours) {
            std::vector<PointF> points;
            for (const auto& p : contour) points.emplace_back(x + static_cast<float>(p.x) * s, y + static_cast<float>(p.y) * s);
            path.StartFigure();
            if (stroke.fill && points.size() >= 3) path.AddPolygon(points.data(), static_cast<int>(points.size()));
            else if (points.size() >= 2) path.AddLines(points.data(), static_cast<int>(points.size()));
        }
        const Color color = !enabled ? Color(255, 112, 112, 112) : stroke.accent ? accent : Color(255, 222, 222, 222);
        Pen pen(color, 1.6f * s); pen.SetLineJoin(LineJoinRound); pen.SetStartCap(LineCapRound); pen.SetEndCap(LineCapRound);
        SolidBrush fill(color);
        if (stroke.fill) g.FillPath(&fill, &path);
        else g.DrawPath(&pen, &path);
    }
}
unsigned modifiers(int changing = 0, bool down = false) {
    auto held = [=](int key) { return key == changing ? down : (GetAsyncKeyState(key) & 0x8000) != 0; };
    return ((held(VK_LCONTROL) || held(VK_RCONTROL)) ? control : 0u) |
        ((held(VK_LMENU) || held(VK_RMENU)) ? alt : 0u) |
        ((held(VK_LSHIFT) || held(VK_RSHIFT)) ? shift : 0u) |
        ((held(VK_LWIN) || held(VK_RWIN)) ? meta : 0u);
}
bool renderPixels(const WheelFrame& frame, int size, void* pixels) {
    using namespace Gdiplus;
    const float s = static_cast<float>(frame.gesture.radius / 178.0);
    const float center = size / 2.0f, outer = static_cast<float>(frame.gesture.radius), inner = outer * .28f;
    {
        Bitmap canvas(size, size, size * 4, PixelFormat32bppPARGB, static_cast<BYTE*>(pixels));
        if (canvas.GetLastStatus() != Ok) return false;
        Graphics g(&canvas);
        if (g.GetLastStatus() != Ok) return false;
        g.Clear(Color(0, 0, 0, 0)); g.SetSmoothingMode(SmoothingModeAntiAlias);
        g.SetTextRenderingHint(TextRenderingHintAntiAliasGridFit);
        const unsigned accent = frame.appearance.accent;
        Color color(255, static_cast<BYTE>(accent >> 16), static_cast<BYTE>(accent >> 8), static_cast<BYTE>(accent));
        const auto rgb = [](unsigned value) { return Color(255, static_cast<BYTE>(value >> 16), static_cast<BYTE>(value >> 8), static_cast<BYTE>(value)); };
        SolidBrush background(Color(255, 16, 16, 16)), middle(Color(255, 9, 9, 9)), ink(Color(255, 230, 230, 230));
        SolidBrush dim(Color(255, 140, 140, 140)), hover(rgb(frame.appearance.hover));
        Pen divider(Color(255, 43, 43, 43), s), highlight(color, 2 * s);
        RectF bounds(center - outer, center - outer, outer * 2, outer * 2);
        g.FillEllipse(&background, bounds);
        const int count = frame.gesture.snapshot->directions;
        const float sweep = 360.0f / count;
        const wchar_t* families[] = {L"Arial", L"Trebuchet MS", L"Verdana"};
        FontFamily family(families[std::clamp(frame.appearance.typeface, 0, 2)]);
        Font font(family.GetLastStatus() == Ok ? &family : FontFamily::GenericSansSerif(), static_cast<float>(WheelContent::fontSize) * s, FontStyleRegular, UnitPixel);
        StringFormat format; format.SetAlignment(StringAlignmentCenter); format.SetLineAlignment(StringAlignmentCenter);
        format.SetFormatFlags(StringFormatFlagsLineLimit);
        format.SetTrimming(StringTrimmingEllipsisCharacter);
        for (int i = 0; i < count; ++i) {
            const float start = -90 + i * sweep - sweep / 2;
            GraphicsPath sectorPath;
            sectorPath.AddArc(bounds, start, sweep);
            sectorPath.AddArc(center - inner, center - inner, inner * 2, inner * 2, start + sweep, -sweep);
            sectorPath.CloseFigure();
            const bool enabled = !frame.gesture.snapshot->slots[i].empty();
            if (i == frame.selected) g.FillPath(&hover, &sectorPath);
            g.DrawPath(&divider, &sectorPath);
            const auto& content = wheelContent(count, i);
            const float x = center + static_cast<float>(content.x) * s, y = center + static_cast<float>(content.y) * s;
            const float width = static_cast<float>(content.width) * s;
            const auto label = wide(frame.appearance.labels[i].empty() ? "Empty" : frame.appearance.labels[i]);
            const auto state = g.Save(); g.SetClip(&sectorPath, CombineModeIntersect);
            drawIcon(g, frame.appearance.icons[i].empty() ? "plus" : frame.appearance.icons[i], x + width / 2 - 12 * s, y, s, rgb(frame.appearance.iconAccent), enabled);
            g.DrawString(label.c_str(), -1, &font, RectF(x, y + static_cast<float>(WheelContent::labelTop) * s, width, static_cast<float>(WheelContent::labelHeight) * s), &format, enabled ? &ink : &dim);
            g.Restore(state);
            if (i == frame.selected && enabled) g.DrawArc(&highlight, bounds, start + 1, sweep - 2);
        }
        g.FillEllipse(&middle, center - inner, center - inner, inner * 2, inner * 2);
        g.DrawEllipse(&divider, center - inner, center - inner, inner * 2, inner * 2);
        g.DrawEllipse(&divider, bounds);
        drawIcon(g, "reflex", center - 27 * s, center - 27 * s, s * 54 / 24, color, true);
        g.Flush(FlushIntentionSync);
        return g.GetLastStatus() == Ok;
    }
}
bool renderPingPixels(const PingFrame& frame, int size, void* pixels) {
    using namespace Gdiplus;
    Bitmap canvas(size, size, size * 4, PixelFormat32bppPARGB, static_cast<BYTE*>(pixels));
    if (canvas.GetLastStatus() != Ok) return false;
    Graphics g(&canvas);
    g.Clear(Color(0, 0, 0, 0)); g.SetSmoothingMode(SmoothingModeAntiAlias);
    g.ScaleTransform(static_cast<float>(PingOverlay::artworkScale), static_cast<float>(PingOverlay::artworkScale));
    const float dpi = static_cast<float>(frame.scale);
    const auto& mark = frame.mark;
    {
        const auto alpha = static_cast<BYTE>(std::clamp(mark.opacity, 0.0, 1.0) * 255);
        const float x = static_cast<float>(mark.x) * dpi, y = static_cast<float>(mark.y) * dpi;
        for (const auto& ripple : mark.rings) {
            const float radius = static_cast<float>(ripple.radius) * dpi;
            const auto opacity = static_cast<BYTE>(ripple.opacity * 255);
            Pen ring(Color(opacity, 243, 223, 63), static_cast<float>(ripple.width) * dpi);
            Pen glow(Color(static_cast<BYTE>(opacity * .14), 249, 231, 85), static_cast<float>(ripple.width + 3) * dpi);
            ring.SetStartCap(LineCapRound); ring.SetEndCap(LineCapRound);
            glow.SetStartCap(LineCapRound); glow.SetEndCap(LineCapRound);
            for (float start : {0.0f, 180.0f}) {
                const RectF bounds(x - radius, y + 18 * dpi - radius * .85f, radius * 2, radius * 1.7f);
                const float angle = start + static_cast<float>(ripple.rotation);
                g.DrawArc(&glow, bounds, angle, 135); g.DrawArc(&ring, bounds, angle, 135);
            }
        }
        const float glyphY = y - 8 * dpi + static_cast<float>(mark.drop) * dpi;
        for (int trail = mark.trail > 0 ? 2 : 0; trail >= 0; --trail) for (const auto& stroke : sharedIcons().at("missing-ping")) {
            GraphicsPath shape(FillModeAlternate);
            for (const auto& contour : stroke.contours) {
                std::vector<PointF> points;
                for (const auto& p : contour) points.emplace_back(x + static_cast<float>(p.x - 11.5) * dpi * 1.55f, glyphY - trail * 5 * dpi + static_cast<float>(p.y - 24) * dpi * 1.9f);
                if (points.size() >= 3) { shape.StartFigure(); shape.AddPolygon(points.data(), static_cast<int>(points.size())); }
            }
            if (trail) {
                SolidBrush ghost(Color(static_cast<BYTE>(alpha * mark.trail * .22 / trail), 249, 223, 85));
                g.FillPath(&ghost, &shape); continue;
            }
            Pen outline(Color(alpha, 76, 59, 20), 1.1f * dpi); outline.SetLineJoin(LineJoinRound);
            LinearGradientBrush gold(PointF(x, glyphY - 46 * dpi), PointF(x, glyphY), Color(alpha, 255, 232, 117), Color(alpha, 209, 167, 61));
            g.DrawPath(&outline, &shape); g.FillPath(&gold, &shape);
        }
    }
    g.Flush(FlushIntentionSync);
    return g.GetLastStatus() == Ok;
}
void paintPing(HWND pingWindow, const PingFrame& value) {
    const auto* frame = &value;
    HWND host = GetAncestor(GetForegroundWindow(), GA_ROOTOWNER);
    auto error = windowsOverlay::attachOwner(pingWindow, host);
    if (!error.empty()) { pingOverlay.clear(); setOverlayError(std::move(error)); ShowWindow(pingWindow, SW_HIDE); return; }
    const int size = static_cast<int>(PingOverlay::size * frame->scale);
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = size; info.bmiHeader.biHeight = -size;
    info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HDC screen = GetDC(nullptr), dc = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap || !dc || !pixels) {
        if (bitmap) DeleteObject(bitmap); if (dc) DeleteDC(dc); ReleaseDC(nullptr, screen);
        pingOverlay.clear(); ShowWindow(pingWindow, SW_HIDE); setOverlayError("Could not draw Missing ping."); return;
    }
    const auto previous = SelectObject(dc, bitmap);
    bool success = previous && previous != HGDI_ERROR && renderPingPixels(*frame, size, pixels);
    POINT origin{static_cast<LONG>(frame->origin.x - size / 2.0), static_cast<LONG>(frame->origin.y - size / 2.0)}, source{};
    SIZE dimensions{size, size}; BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
    if (success) success = UpdateLayeredWindow(pingWindow, screen, &origin, &dimensions, dc, &source, 0, &blend, ULW_ALPHA) != FALSE;
    if (success) success = SetWindowPos(pingWindow, HWND_TOPMOST, origin.x, origin.y, size, size, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER) != FALSE;
    if (success) success = windowsOverlay::keepAboveHost(pingWindow, host).empty();
    if (previous && previous != HGDI_ERROR) SelectObject(dc, previous);
    DeleteObject(bitmap); DeleteDC(dc); ReleaseDC(nullptr, screen);
    if (!success) { pingOverlay.clear(); ShowWindow(pingWindow, SW_HIDE); setOverlayError("Windows could not show Missing ping."); }
}
void refreshPing() {
    const auto frames = pingOverlay.frames(clockMs(), platformForeground());
    std::array<bool, PingOverlay::capacity> visible{};
    for (const auto& frame : frames) { paintPing(pingWindows[frame.slot], frame); visible[frame.slot] = true; }
    for (std::size_t i = 0; i < pingWindows.size(); ++i) if (!visible[i] && IsWindowVisible(pingWindows[i])) ShowWindow(pingWindows[i], SW_HIDE);
}
bool paint(const WheelFrame& frame) {

    HWND host = GetAncestor(GetForegroundWindow(), GA_ROOTOWNER);
    if (auto error = windowsOverlay::attachOwner(wheelWindow, host); !error.empty()) {
        setOverlayError(std::move(error)); return false;
    }
    const int size = static_cast<int>(360 * frame.gesture.radius / 178.0);
    const double center = size / 2.0;
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = size; info.bmiHeader.biHeight = -size;
    info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HDC screen = GetDC(nullptr), dc = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap || !dc || !pixels) {
        setOverlayError("Could not allocate its drawing surface (Windows " + std::to_string(GetLastError()) + ").");
        if (bitmap) DeleteObject(bitmap); if (dc) DeleteDC(dc); ReleaseDC(nullptr, screen); return false;
    }
    const auto previous = SelectObject(dc, bitmap);
    bool success = renderPixels(frame, size, pixels);
    if (!success) setOverlayError("Windows could not draw the wheel artwork.");
    const auto* words = static_cast<const std::uint32_t*>(pixels);
    const auto opaque = std::count_if(words, words + size * size, [](auto pixel) { return pixel >> 24 == 255; });
    if (!previous || previous == HGDI_ERROR || GetCurrentObject(dc, OBJ_BITMAP) != bitmap) {
        success = false; setOverlayError("Windows could not select the wheel drawing surface.");
    }
    if (success && opaque < size * size / 2) {
        success = false; setOverlayError("The wheel drawing surface is empty (" + std::to_string(opaque) + " visible pixels).");
    }
    POINT origin{static_cast<LONG>(frame.gesture.origin.x - center), static_cast<LONG>(frame.gesture.origin.y - center)}, source{};
    SIZE dimensions{size, size}; BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
    if (success && !UpdateLayeredWindow(wheelWindow, screen, &origin, &dimensions, dc, &source, 0, &blend, ULW_ALPHA)) {
        success = false; setOverlayError("Windows rejected the transparent window (Windows " + std::to_string(GetLastError()) + ").");
    }
    if (success && !SetWindowPos(wheelWindow, HWND_TOPMOST, origin.x, origin.y, size, size, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER)) {
        success = false; setOverlayError("Windows could not show the wheel (Windows " + std::to_string(GetLastError()) + ").");
    }
    if (success) {

        const auto error = windowsOverlay::keepAboveHost(wheelWindow, host);
        setOverlayError(error);
        success = error.empty();
    }
    wheelShown = IsWindowVisible(wheelWindow) != FALSE;
    SelectObject(dc, previous); DeleteObject(bitmap); DeleteDC(dc); ReleaseDC(nullptr, screen);
    return success;
}
void refreshWheel() {
    auto frame = runtime().frame(clockMs(), platformForeground(), cursorPoint());
    if (!frame) { if (wheelShown.exchange(false)) ShowWindow(wheelWindow, SW_HIDE); paintedSequence = 0; return; }
    if (paintedSequence != frame->gesture.sequence || paintedSector != frame->selected) {
        if (paint(*frame)) { paintedSequence = frame->gesture.sequence; paintedSector = frame->selected; }
    } else {
        setOverlayError(windowsOverlay::keepAboveHost(wheelWindow, GetAncestor(GetForegroundWindow(), GA_ROOTOWNER)));
    }
}
LRESULT CALLBACK keyboard(int code, WPARAM message, LPARAM parameter) {
    if (code >= 0) {
        const auto& event = *reinterpret_cast<KBDLLHOOKSTRUCT*>(parameter);
        const bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        const int key = static_cast<int>(event.vkCode);
        const bool dismissedPing = down && key == VK_ESCAPE && !(event.flags & LLKHF_INJECTED) && platformForeground() && pingOverlay.running();
        if (dismissedPing) { pingOverlay.clear(); refreshPing(); }
        const Input input{key, down, modifiers(key, down), cursorPoint(), platformForeground(), (event.flags & LLKHF_INJECTED) != 0};
        const bool consumed = runtime().input(input, clockMs(), 178 * scale()) || dismissedPing;
        if (consumed || wheelShown) requestPaint();
        if (consumed) return 1;
    }
    return CallNextHookEx(keyboardHook, code, message, parameter);
}
LRESULT CALLBACK mouse(int code, WPARAM message, LPARAM parameter) {
    if (code >= 0) {
        const auto& event = *reinterpret_cast<MSLLHOOKSTRUCT*>(parameter);
        int key = 0; bool down = false;
        if (message == WM_LBUTTONDOWN || message == WM_LBUTTONUP) { key = 1; down = message == WM_LBUTTONDOWN; }
        else if (message == WM_RBUTTONDOWN || message == WM_RBUTTONUP) { key = 2; down = message == WM_RBUTTONDOWN; }
        else if (message == WM_MBUTTONDOWN || message == WM_MBUTTONUP) { key = 4; down = message == WM_MBUTTONDOWN; }
        else if (message == WM_XBUTTONDOWN || message == WM_XBUTTONUP) { key = HIWORD(event.mouseData) == XBUTTON1 ? 5 : 6; down = message == WM_XBUTTONDOWN; }
        const bool consumed = key && runtime().input(Input{key, down, modifiers(), {static_cast<double>(event.pt.x), static_cast<double>(event.pt.y)},
            platformForeground(), (event.flags & LLMHF_INJECTED) != 0}, clockMs(), 178 * scale());
        if (consumed || wheelShown) requestPaint();
        if (consumed) return 1;
    }
    return CallNextHookEx(mouseHook, code, message, parameter);
}
LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM w, LPARAM l) {
    if (message == WM_TIMER || message == refreshMessage || message == openWheelMessage || message == pingMessage) {
        refreshQueued = false;
        try {
            if (message == pingMessage && platformForeground()) pingOverlay.begin(cursorPoint(), clockMs(), scale());
            if (message == openWheelMessage && !runtime().openWheel(cursorPoint(), clockMs(), 178 * scale(), platformForeground()))
                setOverlayError("Finish the current Photoshop dialog or command, then try again.");
            refreshWheel();
            refreshPing();
        } catch (const std::exception& error) { setOverlayError(error.what()); }
        catch (...) { setOverlayError("Windows could not paint the wheel."); }
        return 0;
    }
    if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    if (message == WM_NCHITTEST) return HTTRANSPARENT;
    return DefWindowProcW(window, message, w, l);
}
void cleanup() {
    if (keyboardHook) UnhookWindowsHookEx(keyboardHook);
    if (mouseHook) UnhookWindowsHookEx(mouseHook);
    keyboardHook = mouseHook = nullptr;
    if (wheelWindow) DestroyWindow(wheelWindow);
    wheelWindow = nullptr;
    for (auto& pingWindow : pingWindows) { if (pingWindow) DestroyWindow(pingWindow); pingWindow = nullptr; }
    pingOverlay.clear();
    UnregisterClassW(L"SynkitReflexHybridWheel", moduleInstance);
    if (gdiplusToken) Gdiplus::GdiplusShutdown(gdiplusToken);
    gdiplusToken = 0;
}
}
const char* platformName() { return "win32"; }
bool platformForeground() {
    DWORD process = 0; GetWindowThreadProcessId(GetForegroundWindow(), &process);
    return process == GetCurrentProcessId();
}
bool platformOpenWheel() { return platformForeground() && wheelWindow && PostMessageW(wheelWindow, openWheelMessage, 0, 0); }
bool platformMissingPing() { return platformForeground() && wheelWindow && pingWindows[0] && PostMessageW(wheelWindow, pingMessage, 0, 0); }
std::string platformError() { std::lock_guard lock(errorMutex); return overlayError; }
void platformStart() {
    if (worker.joinable()) return;
    std::promise<std::string> started;
    auto result = started.get_future();
    worker = std::thread([ready = std::move(started)]() mutable {
        workerId = GetCurrentThreadId();
        MSG message{}; PeekMessageW(&message, nullptr, 0, 0, PM_NOREMOVE);
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            reinterpret_cast<LPCWSTR>(&windowProc), &moduleInstance);
        Gdiplus::GdiplusStartupInput startup;
        if (Gdiplus::GdiplusStartup(&gdiplusToken, &startup, nullptr) != Gdiplus::Ok) { ready.set_value("Could not start Reflex graphics."); return; }
        WNDCLASSW cls{}; cls.lpfnWndProc = windowProc; cls.hInstance = moduleInstance; cls.lpszClassName = L"SynkitReflexHybridWheel";
        RegisterClassW(&cls);
        wheelWindow = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT,
            cls.lpszClassName, L"Reflex", WS_POPUP, 0, 0, 360, 360, nullptr, nullptr, moduleInstance, nullptr);
        for (auto& pingWindow : pingWindows) pingWindow = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT,
            cls.lpszClassName, L"Reflex missing ping", WS_POPUP, 0, 0, PingOverlay::size, PingOverlay::size, nullptr, nullptr, moduleInstance, nullptr);
        keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard, moduleInstance, 0);
        mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouse, moduleInstance, 0);
        if (!wheelWindow || std::any_of(pingWindows.begin(), pingWindows.end(), [](HWND window) { return !window; }) || !keyboardHook || !mouseHook || !SetTimer(wheelWindow, 1, 16, nullptr)) {
            cleanup(); ready.set_value("Windows could not start Reflex input. Reload the plugin."); return;
        }
        ready.set_value("");
        while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
        cleanup();
    });
    const auto error = result.get();
    if (!error.empty()) { worker.join(); workerId = 0; throw std::runtime_error(error); }
}
void platformStop() {
    if (worker.joinable()) { PostThreadMessageW(workerId, WM_QUIT, 0, 0); worker.join(); }
    workerId = 0; paintedSequence = 0; paintedSector = -2; refreshQueued = false; wheelShown = false; setOverlayError("");
}
}
