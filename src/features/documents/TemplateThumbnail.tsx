import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import type { DocumentStyle } from "./documentStyle";
import { demoContextForTemplate, getTemplatePreviewHtml } from "./templatePreviewHtml";
import { fitSheetScale, sheetCssSizeForTemplate } from "./canvas/sheetPreview";

const THUMB_W = 120;
const THUMB_H = 170;

type TemplateThumbnailProps = {
  template: DocumentTemplate;
  documentStyle?: DocumentStyle | null;
  locale: string;
  currency: string;
  vatRate?: number | null;
  logoUrl?: string | null;
  companyName?: string | null;
  industrySlug?: string | null;
  className?: string;
};

/**
 * Lazy thumbnail: IntersectionObserver gates rendering; HTML is memoized per template version.
 * Scales the full sheet (page size + orientation) to fit the thumb box, centered.
 */
export function TemplateThumbnail({
  template,
  documentStyle = null,
  locale,
  currency,
  vatRate,
  logoUrl,
  companyName,
  industrySlug,
  className,
}: TemplateThumbnailProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const srcDoc = useMemo(() => {
    if (!visible) return null;
    const ctx = demoContextForTemplate(template, {
      locale,
      currency,
      vatRate,
      logoUrl,
      companyName,
      industrySlug,
    });
    return getTemplatePreviewHtml(template, ctx, documentStyle);
  }, [visible, template, documentStyle, locale, currency, vatRate, logoUrl, companyName, industrySlug]);

  const sheet = useMemo(() => sheetCssSizeForTemplate(template), [template]);
  const scale = fitSheetScale(sheet, THUMB_W, THUMB_H);
  const scaledW = sheet.widthPx * scale;
  const scaledH = sheet.heightPx * scale;

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ width: THUMB_W, height: THUMB_H }}
      aria-label={t("settings.printTemplates.thumbnailLabel")}
      data-testid="template-thumbnail"
      data-sheet-w={Math.round(sheet.widthMm)}
      data-sheet-h={Math.round(sheet.heightMm)}
    >
      <div className="relative h-full w-full overflow-hidden rounded border border-border bg-[#eef0f3] shadow-xs">
        {srcDoc ? (
          <div
            className="absolute overflow-hidden"
            style={{
              left: (THUMB_W - scaledW) / 2,
              top: (THUMB_H - scaledH) / 2,
              width: scaledW,
              height: scaledH,
            }}
          >
            <iframe
              title={t("settings.printTemplates.thumbnailLabel")}
              sandbox=""
              srcDoc={srcDoc}
              tabIndex={-1}
              scrolling="no"
              className="pointer-events-none origin-top-left border-0 bg-transparent"
              style={{
                width: sheet.widthPx,
                height: sheet.heightPx,
                transform: `scale(${scale})`,
              }}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/40 text-[10px] text-muted-foreground">
            …
          </div>
        )}
      </div>
    </div>
  );
}
