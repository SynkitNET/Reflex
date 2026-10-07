
#include "../src/platform_win.cpp"
#include <iostream>
void savePng(std::vector<std::uint32_t>& pixels, int size, const char* path) {
    Gdiplus::Bitmap image(size, size, size * 4, PixelFormat32bppPARGB, reinterpret_cast<BYTE*>(pixels.data()));
    UINT count = 0, bytes = 0; Gdiplus::GetImageEncodersSize(&count, &bytes);
    std::vector<BYTE> storage(bytes); auto encoders = reinterpret_cast<Gdiplus::ImageCodecInfo*>(storage.data());
    Gdiplus::GetImageEncoders(count, bytes, encoders);
    for (UINT i = 0; i < count; ++i) if (wcscmp(encoders[i].MimeType, L"image/png") == 0) {
        if (image.Save(reflex::wide(path).c_str(), &encoders[i].Clsid, nullptr) != Gdiplus::Ok) throw std::runtime_error("Could not save overlay preview");
        return;
    }
    throw std::runtime_error("PNG encoder unavailable");
}
void checkLabels() {
    for (int count : {4, 8}) for (int typeface : {0, 1, 2}) for (double scale : {1.0, 1.5, 2.0}) {
        const int size = static_cast<int>(360 * scale);
        reflex::Snapshot snapshot; snapshot.directions = count; snapshot.slots.fill("test");
        reflex::Appearance appearance; appearance.labels.fill(" "); appearance.icons.fill("plus"); appearance.typeface = typeface;
        reflex::WheelFrame frame{{1, std::make_shared<const reflex::Snapshot>(snapshot), {}, 178 * scale, false}, appearance, -1};
        std::vector<std::uint32_t> blank(static_cast<std::size_t>(size) * size), pixels(blank.size());
        if (!reflex::renderPixels(frame, size, blank.data())) throw std::runtime_error("Could not render baseline wheel");
        for (int slot = 0; slot < count; ++slot) for (const auto* title : {
            "Convert to Smart Object with an exceptionally long action name",
            "LongUnbrokenPhotoshopActionNameThatMustStayInsideItsOwnSection"}) {
            frame.appearance.labels.fill(" "); frame.appearance.labels[slot] = title;
            if (!reflex::renderPixels(frame, size, pixels.data())) throw std::runtime_error("Could not render long label");
            int ink = 0;
            for (int y = 0; y < size; ++y) for (int x = 0; x < size; ++x) {
                if (pixels[y * size + x] == blank[y * size + x]) continue;
                ++ink;
                if (reflex::sector({x + .5, y + .5}, {size / 2.0, size / 2.0}, 178 * scale, count) != slot)
                    throw std::runtime_error("Long wheel label spills into another section");
                if (std::hypot(x + .5 - size / 2.0, y + .5 - size / 2.0) > 174 * scale)
                    throw std::runtime_error("Long wheel label crosses the outer rim");
            }
            if (ink < 20) throw std::runtime_error("Long wheel label disappeared instead of wrapping");
        }
    }
}
void checkDisabledIcons() {
    reflex::Snapshot snapshot; snapshot.directions = 8;
    reflex::Appearance appearance; appearance.labels.fill(" "); appearance.icons.fill("plus");
    reflex::WheelFrame frame{{1, std::make_shared<const reflex::Snapshot>(snapshot), {}, 178, false}, appearance, -1};
    std::vector<std::uint32_t> blank(360 * 360), pixels(blank.size());
    if (!reflex::renderPixels(frame, 360, blank.data())) throw std::runtime_error("Could not render disabled wheel");
    for (const auto& [name, drawing] : reflex::sharedIcons()) {
        if (name == "plus") continue;
        frame.appearance.icons[3] = name;
        if (!reflex::renderPixels(frame, 360, pixels.data())) throw std::runtime_error("Could not render disabled command icon");
        int different = 0;
        for (std::size_t i = 0; i < pixels.size(); ++i) if (pixels[i] != blank[i]) ++different;
        if (different < 5) throw std::runtime_error("Disabled command icon was replaced by a plus: " + name);
    }
}
int main(int argc, char** argv) {
    ULONG_PTR token = 0;
    Gdiplus::GdiplusStartupInput input;
    if (Gdiplus::GdiplusStartup(&token, &input, nullptr) != Gdiplus::Ok) return 1;
    int result = 0;
    try {
        checkLabels(); checkDisabledIcons();
        reflex::Snapshot snapshot;
        snapshot.directions = 8;
        snapshot.slots.fill("layer.new");
        reflex::Appearance appearance;
        appearance.labels = {"New layer", "Duplicate selected layers", "Delete", "Convert to Smart Object", "Deselect", "Add layer mask", "Undo", "Hue / Saturation"};
        appearance.icons = {"layer-new", "copy", "trash", "cube", "deselect", "mask", "undo", "hue"};
        for (double scale : {1.0, 1.5, 2.0}) {
            const int size = static_cast<int>(360 * scale);
            std::vector<std::uint32_t> pixels(static_cast<std::size_t>(size) * size);
            reflex::WheelFrame frame{{1, std::make_shared<const reflex::Snapshot>(snapshot), {}, 178 * scale, false}, appearance, 0};
            if (!reflex::renderPixels(frame, size, pixels.data())) throw std::runtime_error("Production wheel renderer returned failure");
            const auto opaque = std::count_if(pixels.begin(), pixels.end(), [](auto pixel) { return pixel >> 24 == 255; });
            if (opaque < size * size / 2) throw std::runtime_error("Wheel buffer is transparent instead of showing the ring");
            if (pixels[0] != 0) throw std::runtime_error("Overlay corners must remain transparent");

            const int center = size / 2;
            for (int y = -static_cast<int>(35 * scale); y <= 35 * scale; ++y) {
                for (int x = -static_cast<int>(35 * scale); x <= 35 * scale; ++x) {
                    if (x*x+y*y > 35*35*scale*scale || (std::abs(x) < 28*scale && std::abs(y) < 28*scale)) continue;
                    if (pixels[(center+y)*size+center+x] != 0xff090909) throw std::runtime_error("Wheel center contains marks outside the logo");
                }
            }
            if (argc >= 2 && scale == 1.5) {
                savePng(pixels, size, argv[1]);
                auto unavailable = snapshot; unavailable.slots.fill("");
                frame.gesture.snapshot = std::make_shared<const reflex::Snapshot>(unavailable);
                if (!reflex::renderPixels(frame, size, pixels.data())) throw std::runtime_error("Disabled preview failed");
                savePng(pixels, size, (std::string(argv[1]) + ".disabled.png").c_str());
            }
        }
        for (double scale : {1.0, 1.5, 2.0}) {
            reflex::PingOverlay effect; effect.begin({}, 100, scale);
            const int size = static_cast<int>(reflex::PingOverlay::size * scale);
            std::vector<std::uint32_t> pixels(static_cast<std::size_t>(size) * size);
            if (!reflex::renderPingPixels(effect.frames(500, true)[0], size, pixels.data())) throw std::runtime_error("Ping renderer failed");
            const auto visible = std::count_if(pixels.begin(), pixels.end(), [](auto pixel) { return pixel >> 24 > 128; });
            const auto gold = std::count_if(pixels.begin(), pixels.end(), [](auto pixel) { return (pixel >> 24) > 128 && ((pixel >> 16) & 255) > (pixel & 255) * 2; });
            if (visible < 300 * scale * scale || gold < 250 * scale * scale) throw std::runtime_error("Missing visible gold ping artwork");
            for (int edge = 0; edge < size; ++edge) if (pixels[edge] || pixels[(size-1)*size+edge] || pixels[edge*size] || pixels[edge*size+size-1]) throw std::runtime_error("Ping artwork clips at overlay edges");
            for (auto pixel : pixels) if (((pixel >> 16) & 255) > (pixel >> 24) || ((pixel >> 8) & 255) > (pixel >> 24) || (pixel & 255) > (pixel >> 24)) throw std::runtime_error("Ping alpha is not premultiplied");
            if (argc >= 3 && scale == 2) savePng(pixels, size, argv[2]);
            for (int age = 16; age < reflex::PingOverlay::lifetime; age += 16) {
                if (!reflex::renderPingPixels(effect.frames(100 + age, true)[0], size, pixels.data())) throw std::runtime_error("Animated ping renderer failed");
                for (int edge = 0; edge < size; ++edge) if (pixels[edge] || pixels[(size-1)*size+edge] || pixels[edge*size] || pixels[edge*size+size-1]) throw std::runtime_error("Dropping ping or motion trail clips at the edge");
                if (argc >= 4 && scale == 2) {
                    const auto framePath = std::string(argv[3]) + "/ping-" + std::to_string(1000 + age) + ".png";
                    savePng(pixels, size, framePath.c_str());
                }
            }
        }
        std::vector<std::uint32_t> mark(96*96);
        {
            Gdiplus::Bitmap bitmap(96, 96, 96*4, PixelFormat32bppPARGB, reinterpret_cast<BYTE*>(mark.data()));
            Gdiplus::Graphics graphics(&bitmap); graphics.Clear(Gdiplus::Color(0,0,0,0));
            reflex::drawIcon(graphics, "reflex", 0, 0, 4, Gdiplus::Color(255,255,255,255), true); graphics.Flush();
        }
        if (mark[48*96+48] >> 24 != 255 || mark[8*96+48] >> 24 != 255 || mark[23*96+48] != 0 || mark[0*96+48] != 0)
            throw std::runtime_error("Logo lost its filled center or transparent hexagonal gap");
        std::cout << "Windows wheel and ping pixels are visible at 100%, 150% and 200% DPI; long labels stay in their sections for all fonts and 4/8 directions.\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; result = 1; }
    Gdiplus::GdiplusShutdown(token);
    return result;
}
