import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CircleX, EllipsisVertical, Lock, Trash2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { Button } from "../../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../ui/DropdownMenu";

export type OrderDetailFooterProps = {
  isDesktopFeedLayout: boolean;
  isEditing: boolean;
  showCancelAction: boolean;
  showFooterDeleteAction: boolean;
  showOpenLifecycleActions: boolean;
  showConvertEstimate?: boolean;
  convertEstimatePending?: boolean;
  canSaveAndClose: boolean;
  lifecycleBusy: boolean;
  footerSavePending: boolean;
  deleteBlockedReason: string | null;
  deletePending: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onCloseOrder: () => void;
  onConvertEstimate?: () => void;
  onSaveAndClose: () => void;
  onCloseWindow: () => void;
};

function OrderDetailFooterComponent({
  isDesktopFeedLayout,
  isEditing,
  showCancelAction,
  showFooterDeleteAction,
  showOpenLifecycleActions,
  showConvertEstimate = false,
  convertEstimatePending = false,
  canSaveAndClose,
  lifecycleBusy,
  footerSavePending,
  deleteBlockedReason,
  deletePending,
  onCancel,
  onDelete,
  onCloseOrder,
  onConvertEstimate,
  onSaveAndClose,
  onCloseWindow,
}: OrderDetailFooterProps) {
  const { t } = useTranslation();

  return (
                <footer
                  data-testid="order-detail-footer"
                  className={cn(
                    "shrink-0 border-t border-border bg-background px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]",
                    // Phones: two rows so labels are never truncated —
                    // row 1 «Сохранить и закрыть» full width, row 2 «Закрыть заказ» + ⋯.
                    isDesktopFeedLayout ? "flex flex-wrap items-center justify-end gap-2" : "grid grid-cols-[1fr_auto] gap-2",
                  )}
                >
                  {isDesktopFeedLayout && showCancelAction ? (
                    <div className="mr-auto flex min-w-0 max-w-full flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 self-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onCancel()}
                        disabled={lifecycleBusy}
                      >
                        <CircleX />
                        {t("orders.lifecycle.cancelAction")}
                      </Button>
                      <p
                        className="text-xs text-destructive [overflow-wrap:anywhere]"
                        data-testid="order-detail-cancel-delete-hint"
                      >
                        {t("orders.lifecycle.cancelDeleteHint")}
                      </p>
                    </div>
                  ) : null}

                  {isDesktopFeedLayout && showFooterDeleteAction ? (
                    <div className="mr-auto flex min-w-0 max-w-full flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={Boolean(deleteBlockedReason) || deletePending}
                        title={deleteBlockedReason ?? undefined}
                        onClick={onDelete}
                      >
                        <Trash2 className="size-4 shrink-0" />
                        <span className="truncate">{t(showConvertEstimate ? "orders.estimates.delete" : "orders.actions.delete")}</span>
                      </Button>
                      {deleteBlockedReason ? (
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{deleteBlockedReason}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {showConvertEstimate && !isEditing && onConvertEstimate ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "min-h-11",
                        !isDesktopFeedLayout && "w-full min-w-0",
                        !isDesktopFeedLayout && !showCancelAction && !showFooterDeleteAction && "col-span-2",
                      )}
                      onClick={() => onConvertEstimate()}
                      disabled={lifecycleBusy || footerSavePending || convertEstimatePending}
                      loading={convertEstimatePending}
                    >
                      <span className="truncate">{t("orders.estimates.convertButton")}</span>
                    </Button>
                  ) : null}

                  {showOpenLifecycleActions && !isEditing ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "min-h-11",
                        !isDesktopFeedLayout && "w-full min-w-0",
                        !isDesktopFeedLayout && !showCancelAction && !showFooterDeleteAction && "col-span-2",
                      )}
                      onClick={() => onCloseOrder()}
                      disabled={lifecycleBusy || footerSavePending}
                    >
                      <Lock />
                      <span className="truncate">{t("orders.lifecycle.closeAction")}</span>
                    </Button>
                  ) : null}

                  {canSaveAndClose ? (
                    <Button
                      type="button"
                      className={cn("min-h-11", !isDesktopFeedLayout && "order-first col-span-2 w-full min-w-0")}
                      loading={footerSavePending}
                      onClick={() => onSaveAndClose()}
                    >
                      <span className="truncate">{t("orders.detail.saveAndClose")}</span>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className={cn("min-h-11", !isDesktopFeedLayout && "order-first col-span-2 w-full min-w-0")}
                      onClick={onCloseWindow}
                    >
                      <span className="truncate">{t("orders.detail.closeWindow")}</span>
                    </Button>
                  )}

                  {!isDesktopFeedLayout && (showCancelAction || showFooterDeleteAction) ? (
                    <div className="flex min-w-0 flex-col items-end gap-1">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-11 shrink-0"
                            aria-label={t("common.actions")}
                            disabled={lifecycleBusy || (showFooterDeleteAction && deletePending)}
                          >
                            <EllipsisVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="top">
                          {showCancelAction ? (
                            <DropdownMenuItem
                              className="min-h-11 text-destructive focus:text-destructive"
                              onSelect={() => onCancel()}
                            >
                              <CircleX />
                              {t("orders.lifecycle.cancelAction")}
                            </DropdownMenuItem>
                          ) : null}
                          {showFooterDeleteAction ? (
                            <DropdownMenuItem
                              className="min-h-11 text-destructive focus:text-destructive"
                              disabled={Boolean(deleteBlockedReason) || deletePending}
                              title={deleteBlockedReason ?? undefined}
                              onSelect={() => {
                                if (deleteBlockedReason || deletePending) return;
                                onDelete();
                              }}
                            >
                              <Trash2 />
                              {t(showConvertEstimate ? "orders.estimates.delete" : "orders.actions.delete")}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {showCancelAction ? (
                        <p
                          className="max-w-[11rem] text-right text-xs text-destructive [overflow-wrap:anywhere]"
                          data-testid="order-detail-cancel-delete-hint"
                        >
                          {t("orders.lifecycle.cancelDeleteHint")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </footer>
  );
}

export const OrderDetailFooter = memo(OrderDetailFooterComponent);
