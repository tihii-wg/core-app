import { Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "../../ui/Select";
import { cn } from "../../lib/utils";
import { rangeLabel, reportRanges } from "./reportFormatting";
import { yearReportRange, type ReportRange } from "./reportStats";
import { useReportYears } from "./useReportData";

/** Period filter of Reports / Finance / quick reports: the day ranges, then one entry per calendar year with data. */
export function ReportRangeSelect({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: ReportRange;
  onChange: (range: ReportRange) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const years = useReportYears();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ReportRange)}>
      <SelectTrigger className={cn("w-44", className)} aria-label={ariaLabel}>
        <Calendar aria-hidden="true" className="size-4" />
        <SelectValue>{rangeLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {reportRanges.map((range) => (
          <SelectItem key={range} value={range}>
            {rangeLabel(range)}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>{t("reports.ranges.byYear")}</SelectLabel>
          {years.map((year) => (
            <SelectItem key={year} value={yearReportRange(year)}>
              {rangeLabel(yearReportRange(year))}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
