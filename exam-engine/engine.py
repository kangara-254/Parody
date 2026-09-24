import sys
import os
import fitz  # PyMuPDF
import cv2
import numpy as np
import pytesseract
from pytesseract import Output

DPI = 300
OCR_LANG = "eng"
MIN_CONFIDENCE = 25

# Percentage of page height at the bottom to crop out (removes CamScanner tag)
FOOTER_CROP_PERCENT = 0.05  # 5% of height


def remove_watermark_and_shadows(gray):
    """
    Normalizes uneven illumination and strips faint background watermarks/textures.
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
    norm = cv2.divide(gray.astype(np.float32), background.astype(np.float32), scale=255)
    return norm.astype(np.uint8)


def render_and_clean_page(page, dpi=DPI, crop_footer=True):
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    # Crop out the bottom footer area containing 'Scanned with CamScanner'
    if crop_footer:
        crop_h = int(gray.shape[0] * (1.0 - FOOTER_CROP_PERCENT))
        # Mask out footer region with pure white
        gray[crop_h:, :] = 255

    # Clean watermark background
    cleaned_gray = remove_watermark_and_shadows(gray)

    # Adaptive binarization optimized for text and line preservation
    binarized = cv2.adaptiveThreshold(
        cleaned_gray, 
        255, 
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY, 
        41, 
        20
    )
    return cleaned_gray, binarized


def add_invisible_ocr(page, gray_img, page_rect, min_confidence=MIN_CONFIDENCE):
    config = "--oem 3 --psm 3"
    data = pytesseract.image_to_data(
        gray_img, output_type=Output.DICT, config=config, lang=OCR_LANG
    )

    img_h, img_w = gray_img.shape[:2]
    scale_x = page_rect.width / img_w
    scale_y = page_rect.height / img_h

    for i in range(len(data["text"])):
        text = data["text"][i].strip()

        # Skip CamScanner text just in case any OCR detected it
        if "camscanner" in text.lower():
            continue

        try:
            confidence = float(data["conf"][i])
        except (ValueError, TypeError):
            confidence = -1

        if not text or confidence < min_confidence:
            continue

        x = data["left"][i] * scale_x
        y = data["top"][i] * scale_y
        w = data["width"][i] * scale_x
        h = data["height"][i] * scale_y

        rect = fitz.Rect(x, y, x + w, y + h)
        fontsize = max(4, h * 0.8)

        page.insert_textbox(
            rect,
            text,
            fontsize=fontsize,
            fontname="helv",
            render_mode=3,  # Invisible text
            overlay=True,
        )


def process_pdf(input_pdf_path, output_pdf_path):
    if not os.path.exists(input_pdf_path):
        print(f"Error: File '{input_pdf_path}' not found.")
        return

    print(f"Opening PDF: {input_pdf_path}")
    source = fitz.open(input_pdf_path)
    output = fitz.open()

    for page_num, source_page in enumerate(source):
        print(f"Processing page {page_num + 1}/{len(source)}...")

        gray, binarized = render_and_clean_page(source_page, dpi=DPI, crop_footer=True)
        rect = source_page.rect
        page = output.new_page(width=rect.width, height=rect.height)

        # Encode clean visual image in memory
        success, encoded = cv2.imencode(".png", binarized)
        if not success:
            continue

        page.insert_image(rect, stream=encoded.tobytes())

        # Inject invisible OCR layer
        add_invisible_ocr(page, gray, rect)

    output.save(output_pdf_path, garbage=4, deflate=True, clean=True)
    output.close()
    source.close()
    print(f"Successfully saved pristine PDF: {output_pdf_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: python {sys.argv[0]} <input_pdf_path>")
        sys.exit(1)

    input_file = sys.argv[1]
    base_name, ext = os.path.splitext(input_file)
    output_file = f"{base_name}_CLEAN{ext}"

    process_pdf(input_file, output_file)