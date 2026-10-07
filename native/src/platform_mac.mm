#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#include "reflex/runtime.hpp"
#include "reflex/icons.hpp"
#include "reflex/ping.hpp"
#include "reflex/wheel_layout.hpp"
#include <atomic>
#include <cmath>
#include <numbers>
#include <algorithm>

static NSColor* ReflexColor(unsigned value) {
    return [NSColor colorWithSRGBRed:((value >> 16) & 255) / 255.0 green:((value >> 8) & 255) / 255.0 blue:(value & 255) / 255.0 alpha:1];
}
static void DrawReflexIcon(const std::string& name, CGFloat x, CGFloat y, CGFloat scale, NSColor* accent, bool enabled) {
    const auto& icons = reflex::sharedIcons();
    const auto found = icons.find(name);
    const auto& drawing = found == icons.end() ? icons.at("play") : found->second;
    for (const auto& stroke : drawing) {
        NSBezierPath* path = [NSBezierPath bezierPath];
        path.windingRule = NSEvenOddWindingRule;
        for (const auto& contour : stroke.contours) {
            for (std::size_t p = 0; p < contour.size(); ++p) {
                NSPoint point = NSMakePoint(x + contour[p].x * scale, y + contour[p].y * scale);
                if (!p) [path moveToPoint:point]; else [path lineToPoint:point];
            }
            if (stroke.fill) [path closePath];
        }
        NSColor* color = !enabled ? ReflexColor(0x707070) : stroke.accent ? accent : ReflexColor(0xdedede);
        path.lineWidth = 1.6 * scale; path.lineJoinStyle = NSLineJoinStyleRound; path.lineCapStyle = NSLineCapStyleRound;
        if (stroke.fill) { [color setFill]; [path fill]; } else { [color setStroke]; [path stroke]; }
    }
}

@interface ReflexWheelView : NSView {
@public
    std::optional<reflex::WheelFrame> frame_;
}
@end
@implementation ReflexWheelView
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return NO; }
- (void)drawRect:(NSRect)dirty {
    (void)dirty;
    if (!frame_) return;
    const auto& frame = *frame_;
    const CGFloat center = 180, outer = 178, inner = outer * .28;
    NSColor* accent = ReflexColor(frame.appearance.accent);
    NSColor* line = ReflexColor(0x2b2b2b);
    NSColor* background = ReflexColor(0x101010);
    NSArray<NSString*>* families = @[@"Arial", @"TrebuchetMS", @"Verdana"];
    NSFont* font = [NSFont fontWithName:families[std::clamp(frame.appearance.typeface, 0, 2)] size:reflex::WheelContent::fontSize];
    if (!font) font = [NSFont fontWithName:@"Arial" size:reflex::WheelContent::fontSize];
    NSBezierPath* ring = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(2, 2, 356, 356)];
    [background setFill]; [ring fill];
    const int count = frame.gesture.snapshot->directions;
    const double sweep = 2 * std::numbers::pi / count;
    NSMutableParagraphStyle* style = [[NSMutableParagraphStyle alloc] init];
    style.alignment = NSTextAlignmentCenter; style.lineBreakMode = NSLineBreakByWordWrapping;
    for (int i = 0; i < count; ++i) {
        const double a = -std::numbers::pi / 2 + i * sweep;
        NSBezierPath* sector = [NSBezierPath bezierPath];
        for (int j = 0; j <= 32; ++j) {
            const double angle = a - sweep / 2 + sweep * j / 32;
            NSPoint point = NSMakePoint(center + outer * std::cos(angle), center + outer * std::sin(angle));
            if (j == 0) [sector moveToPoint:point]; else [sector lineToPoint:point];
        }
        for (int j = 32; j >= 0; --j) {
            const double angle = a - sweep / 2 + sweep * j / 32;
            [sector lineToPoint:NSMakePoint(center + inner * std::cos(angle), center + inner * std::sin(angle))];
        }
        [sector closePath];
        if (frame.selected == i) { [ReflexColor(frame.appearance.hover) setFill]; [sector fill]; }
        [line setStroke]; sector.lineWidth = 1; [sector stroke];
        const bool enabled = !frame.gesture.snapshot->slots[i].empty();
        NSString* title = [NSString stringWithUTF8String:frame.appearance.labels[i].c_str()] ?: @"Empty";
        NSDictionary* attrs = @{NSFontAttributeName:font ?: [NSFont systemFontOfSize:reflex::WheelContent::fontSize],
            NSForegroundColorAttributeName:enabled ? ReflexColor(0xe6e6e6) : ReflexColor(0x8c8c8c), NSParagraphStyleAttributeName:style};
        const auto& content = reflex::wheelContent(count, i);
        const CGFloat x = center + content.x, y = center + content.y;
        [NSGraphicsContext saveGraphicsState]; [sector addClip];
        DrawReflexIcon(frame.appearance.icons[i].empty() ? "plus" : frame.appearance.icons[i], x + content.width / 2 - 12, y, 1, ReflexColor(frame.appearance.iconAccent), enabled);
        const NSStringDrawingOptions textOptions = NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingTruncatesLastVisibleLine;
        const NSRect measured = [title boundingRectWithSize:NSMakeSize(content.width, reflex::WheelContent::labelHeight) options:textOptions attributes:attrs];
        const CGFloat textHeight = std::min(reflex::WheelContent::labelHeight, std::ceil(measured.size.height));
        [title drawWithRect:NSMakeRect(x, y + reflex::WheelContent::labelTop + (reflex::WheelContent::labelHeight - textHeight) / 2, content.width, textHeight)
            options:textOptions attributes:attrs context:nil];
        [NSGraphicsContext restoreGraphicsState];
        if (frame.selected == i && enabled) {
            NSBezierPath* edge = [NSBezierPath bezierPath];
            for (int j = 0; j <= 32; ++j) {
                const double angle = a - sweep / 2 + .017 + (sweep - .034) * j / 32;
                NSPoint point = NSMakePoint(center + outer * std::cos(angle), center + outer * std::sin(angle));
                if (!j) [edge moveToPoint:point]; else [edge lineToPoint:point];
            }
            [accent setStroke]; edge.lineWidth = 2; [edge stroke];
        }
    }
    NSBezierPath* middle = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(center-inner, center-inner, inner*2, inner*2)];
    [ReflexColor(0x090909) setFill]; [middle fill];
    [line setStroke]; [middle stroke]; [ring stroke];
    DrawReflexIcon("reflex", center - 27, center - 27, 54.0 / 24, accent, true);
}
@end

@interface ReflexPingView : NSView {
@public
    std::optional<reflex::PingFrame> frame_;
}
@end
@implementation ReflexPingView
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return NO; }
- (void)drawRect:(NSRect)dirty {
    (void)dirty;
    [NSColor.clearColor setFill]; NSRectFillUsingOperation(self.bounds, NSCompositingOperationCopy);
    if (!frame_) return;
    const auto& mark = frame_->mark;
    [NSGraphicsContext saveGraphicsState];
    NSAffineTransform* transform = [NSAffineTransform transform];
    [transform scaleBy:reflex::PingOverlay::artworkScale]; [transform concat];
    {
        const CGFloat x = mark.x, y = mark.y;
        for (const auto& ripple : mark.rings) {
            for (double start : {0.0, 180.0}) {
                NSBezierPath* arc = [NSBezierPath bezierPath];
                for (int i = 0; i <= 32; ++i) {
                    const double angle = (start + ripple.rotation + 135.0 * i / 32) * std::numbers::pi / 180;
                    const NSPoint p = NSMakePoint(x + ripple.radius * std::cos(angle), y + 18 + ripple.radius * .85 * std::sin(angle));
                    if (!i) [arc moveToPoint:p]; else [arc lineToPoint:p];
                }
                arc.lineCapStyle = NSLineCapStyleRound;
                [[ReflexColor(0xf9e755) colorWithAlphaComponent:ripple.opacity * .14] setStroke]; arc.lineWidth = ripple.width + 3; [arc stroke];
                [[ReflexColor(0xf3df3f) colorWithAlphaComponent:ripple.opacity] setStroke]; arc.lineWidth = ripple.width; [arc stroke];
            }
        }
        const double glyphY = y - 8 + mark.drop;
        for (int trail = mark.trail > 0 ? 2 : 0; trail >= 0; --trail) for (const auto& stroke : reflex::sharedIcons().at("missing-ping")) {
            NSBezierPath* shape = [NSBezierPath bezierPath]; shape.windingRule = NSEvenOddWindingRule;
            for (const auto& contour : stroke.contours) {
                for (std::size_t i = 0; i < contour.size(); ++i) {
                    const auto& p = contour[i]; const NSPoint point = NSMakePoint(x + (p.x - 11.5) * 1.55, glyphY - trail * 5 + (p.y - 24) * 1.9);
                    if (!i) [shape moveToPoint:point]; else [shape lineToPoint:point];
                }
                [shape closePath];
            }
            if (trail) {
                [[ReflexColor(0xf9df55) colorWithAlphaComponent:mark.opacity * mark.trail * .22 / trail] setFill]; [shape fill]; continue;
            }
            shape.lineJoinStyle = NSLineJoinStyleRound;
            [[ReflexColor(0x4c3b14) colorWithAlphaComponent:mark.opacity] setStroke]; shape.lineWidth = 1.1; [shape stroke];
            NSGradient* gold = [[NSGradient alloc] initWithStartingColor:[ReflexColor(0xffe875) colorWithAlphaComponent:mark.opacity]
                endingColor:[ReflexColor(0xd1a73d) colorWithAlphaComponent:mark.opacity]];
            [gold drawInBezierPath:shape angle:90];
        }
    }
    [NSGraphicsContext restoreGraphicsState];
}
@end

namespace reflex {
namespace {
NSPanel* panel;
ReflexWheelView* view;
NSMutableArray<NSPanel*>* pingPanels;
NSMutableArray<ReflexPingView*>* pingViews;
PingOverlay pingOverlay;
id monitor;
id resignObserver;
NSTimer* timer;
std::atomic<bool> foreground{false};
std::array<int, 128> pressedKeys{};
unsigned previousModifiers = 0;
bool active() { return NSApp.isActive && NSApp.modalWindow == nil && NSApp.keyWindow.attachedSheet == nil; }
Point cursor() { NSPoint p = NSEvent.mouseLocation; return {p.x, -p.y}; }
unsigned modifiers(NSEventModifierFlags flags) {
    return ((flags & NSEventModifierFlagControl) ? control : 0u) |
        ((flags & NSEventModifierFlagOption) ? alt : 0u) |
        ((flags & NSEventModifierFlagShift) ? shift : 0u) |
        ((flags & NSEventModifierFlagCommand) ? meta : 0u);
}
int key(NSEvent* event) {
    if (event.type == NSEventTypeFlagsChanged) return 0;
    if (event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeLeftMouseUp) return 1;
    if (event.type == NSEventTypeRightMouseDown || event.type == NSEventTypeRightMouseUp) return 2;
    if (event.type == NSEventTypeOtherMouseDown || event.type == NSEventTypeOtherMouseUp)
        return event.buttonNumber == 2 ? 4 : event.buttonNumber == 3 ? 5 : event.buttonNumber == 4 ? 6 : 0;
    if (event.keyCode == kVK_Escape) return 27;
    if (event.keyCode == kVK_Space) return 32;

    TISInputSourceRef source = TISCopyCurrentKeyboardLayoutInputSource();
    if (source) {
        CFDataRef data = static_cast<CFDataRef>(TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData));
        if (data) {
            UInt32 state = 0; UniChar chars[4]{}; UniCharCount length = 0;
            const auto* layout = reinterpret_cast<const UCKeyboardLayout*>(CFDataGetBytePtr(data));
            UCKeyTranslate(layout, event.keyCode, kUCKeyActionDown, 0, LMGetKbdType(), kUCKeyTranslateNoDeadKeysBit, &state, 4, &length, chars);
            CFRelease(source);
            if (length == 1) {
                const int c = chars[0];
                if (c >= 'a' && c <= 'z') return c - 'a' + 'A';
                if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c;
            }
        } else CFRelease(source);
    }
    const unsigned short codes[] = {kVK_F1,kVK_F2,kVK_F3,kVK_F4,kVK_F5,kVK_F6,kVK_F7,kVK_F8,kVK_F9,kVK_F10,kVK_F11,kVK_F12,kVK_F13,kVK_F14,kVK_F15,kVK_F16,kVK_F17,kVK_F18,kVK_F19,kVK_F20};
    for (int i = 0; i < 20; ++i) if (event.keyCode == codes[i]) return 0x70 + i;
    return 0;
}
void refresh() {
    foreground = active();
    auto pings = pingOverlay.frames(clockMs(), foreground);
    std::array<bool, PingOverlay::capacity> visible{};
    for (auto& ping : pings) {
        NSPanel* pingPanel = pingPanels[ping.slot]; ReflexPingView* pingView = pingViews[ping.slot];
        visible[ping.slot] = true;
        [pingPanel setFrameOrigin:NSMakePoint(ping.origin.x - PingOverlay::size / 2, -ping.origin.y - PingOverlay::size / 2)];
        pingView->frame_ = std::move(ping); pingView.needsDisplay = YES;
        [pingPanel orderFrontRegardless];
    }
    for (std::size_t i = 0; i < visible.size(); ++i) if (!visible[i]) {
        [pingPanels[i] orderOut:nil]; ReflexPingView* pingView = pingViews[i]; pingView->frame_.reset();
    }
    auto frame = runtime().frame(clockMs(), foreground, cursor());
    if (!frame) { [panel orderOut:nil]; view->frame_.reset(); return; }
    const bool changed = !view->frame_ || view->frame_->gesture.sequence != frame->gesture.sequence || view->frame_->selected != frame->selected;
    if (changed) {
        [panel setFrameOrigin:NSMakePoint(frame->gesture.origin.x - 180, -frame->gesture.origin.y - 180)];
        view->frame_ = std::move(frame); view.needsDisplay = YES;
    }
    [panel orderFrontRegardless];
}
void onMain(dispatch_block_t block) { if (NSThread.isMainThread) block(); else dispatch_sync(dispatch_get_main_queue(), block); }
}
const char* platformName() { return "darwin"; }
bool platformForeground() { return foreground.load(); }
std::string platformError() { return ""; }
bool platformOpenWheel() {
    __block bool opened = false;
    onMain(^{
        if (monitor) { opened = runtime().openWheel(cursor(), clockMs(), 178, active()); refresh(); }
    });
    return opened;
}
bool platformMissingPing() {
    __block bool opened = false;
    onMain(^{
        if (monitor && active()) { pingOverlay.begin(cursor(), clockMs(), 1); refresh(); opened = true; }
    });
    return opened;
}
void platformStart() {
    onMain(^{
        if (monitor) return;
        panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 360, 360)
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        panel.opaque = NO; panel.backgroundColor = NSColor.clearColor; panel.hasShadow = NO;
        panel.ignoresMouseEvents = YES; panel.hidesOnDeactivate = YES; panel.level = NSFloatingWindowLevel;
        panel.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary;
        view = [[ReflexWheelView alloc] initWithFrame:NSMakeRect(0,0,360,360)]; panel.contentView = view;
        pingPanels = [NSMutableArray arrayWithCapacity:PingOverlay::capacity]; pingViews = [NSMutableArray arrayWithCapacity:PingOverlay::capacity];
        for (std::size_t i = 0; i < PingOverlay::capacity; ++i) {
            NSPanel* pingPanel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, PingOverlay::size, PingOverlay::size)
                styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
            pingPanel.opaque = NO; pingPanel.backgroundColor = NSColor.clearColor; pingPanel.hasShadow = NO;
            pingPanel.ignoresMouseEvents = YES; pingPanel.hidesOnDeactivate = YES; pingPanel.level = NSFloatingWindowLevel;
            pingPanel.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary;
            ReflexPingView* pingView = [[ReflexPingView alloc] initWithFrame:NSMakeRect(0, 0, PingOverlay::size, PingOverlay::size)]; pingPanel.contentView = pingView;
            [pingPanels addObject:pingPanel]; [pingViews addObject:pingView];
        }
        foreground = active();
        monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged | NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp | NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown | NSEventMaskRightMouseUp handler:^NSEvent*(NSEvent* event) {
            const unsigned mods = modifiers(event.modifierFlags);
            const bool flagChange = event.type == NSEventTypeFlagsChanged;
            const bool down = flagChange ? (mods & ~previousModifiers) != 0 : event.type == NSEventTypeKeyDown || event.type == NSEventTypeOtherMouseDown || event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown;
            previousModifiers = mods;
            int code = key(event);
            const bool dismissedPing = down && code == 27 && active() && pingOverlay.running();
            if (dismissedPing) pingOverlay.clear();
            if (event.type == NSEventTypeKeyDown && event.keyCode < pressedKeys.size()) pressedKeys[event.keyCode] = code;
            if (event.type == NSEventTypeKeyUp && event.keyCode < pressedKeys.size()) { if (pressedKeys[event.keyCode]) code = pressedKeys[event.keyCode]; pressedKeys[event.keyCode] = 0; }
            foreground = active();
            const bool consumed = runtime().input(Input{code,down,mods,cursor(),foreground,false}, clockMs(), 178) || dismissedPing;
            refresh();
            return consumed ? nil : event;
        }];
        resignObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidResignActiveNotification object:NSApp queue:nil usingBlock:^(NSNotification*) {
            foreground = false; runtime().frame(clockMs(), false, cursor()); [panel orderOut:nil];
            pingOverlay.clear(); for (NSPanel* pingPanel in pingPanels) [pingPanel orderOut:nil];
        }];
        timer = [NSTimer timerWithTimeInterval:.016 repeats:YES block:^(NSTimer*) { refresh(); }];
        [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
    });
}
void platformStop() {
    onMain(^{
        [timer invalidate]; timer = nil;
        if (monitor) [NSEvent removeMonitor:monitor]; monitor = nil;
        if (resignObserver) [NSNotificationCenter.defaultCenter removeObserver:resignObserver]; resignObserver = nil;
        [panel orderOut:nil]; [panel close]; panel = nil; view = nil;
        pingOverlay.clear(); for (NSPanel* pingPanel in pingPanels) { [pingPanel orderOut:nil]; [pingPanel close]; }
        pingPanels = nil; pingViews = nil;
        foreground = false; previousModifiers = 0; pressedKeys.fill(0);
    });
}
}
