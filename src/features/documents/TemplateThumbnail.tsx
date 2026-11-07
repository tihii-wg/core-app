import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import type { DocumentStyle } from "./documentStyle";
import { demoContextForTemplate, getTemplatePreviewHtml } from "./templatePreviewHtml";

const THUMB_W = 120;
const THUMB_H = 170;
/** Approximate A4 CSS px width used inside the iframe before scale. */
const A4_CSS_WIDTH = 794;

type TemplateThumbnailProps = {
  template: DocumentTemplate;
  documentStyle?: DocumentStyle | null;
  locale: string;
  currency: string;
  vatRate?: number | null;
  logoUrl?: string | null;
  companyName?: string | null;
  className?: string;
};

/**
 * Lazy A4-ratio thumbnail: IntersectionObserver gates rendering; HTML is memoized per template version.
 */
export function TemplateThumbnail({
  template,
  documentStyle = null,
  locale,
  currency,
  vatRate,
  logoUrl,
  companyName,
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
    const ctx = demoContextForTemplate(template, { locale, currency, vatRate, logoUrl, companyName });
    return getTemplatePreviewHtml(template, ctx, documentStyle);
  }, [visible, template, documentStyle, locale, currency, vatRate, logoUrl, companyName]);

  const scale = THUMB_W / A4_CSS_WIDTH;

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ width: THUMB_W, height: THUMB_H }}
      aria-label={t("settings.printTemplates.thumbnailLabel")}
    >
      <div className="h-full w-full overflow-hidden rounded border border-border bg-white shadow-xs">
        {srcDoc ? (
          <iframe
            title={t("settings.printTemplates.thumbnailLabel")}
            sandbox=""
            srcDoc={srcDoc}
            tabIndex={-1}
            className="pointer-events-none origin-top-left border-0 bg-white"
            style={{
              width: A4_CSS_WIDTH,
              height: THUMB_H / scale,
              transform: `scale(${scale})`,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/40 text-[10px] text-muted-foreground">
            …
          </div>
        )}
      </div>
    </div>
  );
}
