from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parents[1] / "outputs" / "miargentina-mockup-final-v2.png"
ASSETS = ROOT / "assets"


def crop(name: str, box: tuple[int, int, int, int], *, quality: int = 92) -> None:
    with Image.open(SOURCE) as image:
        section = image.crop(box).convert("RGB")
        section.save(ASSETS / name, quality=quality, optimize=True, progressive=True)


def optimize_jpeg(name: str, max_width: int, quality: int) -> None:
    path = ASSETS / name
    with Image.open(path) as image:
        image = image.convert("RGB")
        if image.width > max_width:
            height = round(image.height * max_width / image.width)
            image = image.resize((max_width, height), Image.Resampling.LANCZOS)
        image.save(path, quality=quality, optimize=True, progressive=True)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE) as image:
        logo = image.crop((202, 3, 418, 62)).convert("RGBA")
        pixels = []
        for red, green, blue, _ in logo.getdata():
            distance_from_white = max(255 - red, 255 - green, 255 - blue)
            alpha = min(255, distance_from_white * 5)
            pixels.append((red, green, blue, alpha))
        logo.putdata(pixels)
        logo.save(ASSETS / "logo-approved.png", optimize=True)
    crop("hero-community.jpg", (760, 65, 1672, 435), quality=94)
    crop("hero-mate.jpg", (0, 65, 225, 287), quality=92)
    crop("hero-asado.jpg", (0, 268, 238, 435), quality=92)
    crop("card-con-sabor.jpg", (244, 448, 508, 557))
    crop("card-sabias.jpg", (530, 448, 807, 557))
    crop("card-sobre-nosotros.jpg", (829, 448, 1107, 557))
    crop("card-eventos.jpg", (1128, 448, 1391, 569))
    optimize_jpeg("hero-community.jpg", 1200, 86)
    optimize_jpeg("kermesse.jpg", 1200, 72)
    optimize_jpeg("legacy-bg-1.jpg", 1400, 70)
    optimize_jpeg("legacy-bg-2.jpg", 1100, 62)


if __name__ == "__main__":
    main()
