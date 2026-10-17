"use client";

/**
 * Claude Design System — image lightbox (slot `imageLightbox`).
 *
 * The pi component is a `<dialog>` opened with `showModal()`, and that choice
 * is kept: the top layer already gives the lightbox modality, inertness for
 * the page behind it and native Escape. The whole effect is carried over —
 * body scroll locked and restored, focus moved to the close button, the dialog
 * closed and the trigger refocused on cleanup, `onCancel` prevented so the
 * element never closes behind React's back, and Escape handled explicitly so
 * it cannot bubble into a surrounding dialog's own handler.
 *
 * Only the paint changes: a blurred veil on `::backdrop`, a CDS radius on the
 * image, and a glass close button that keeps the 36/44px touch targets.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { SlotPropsMap } from "@/components/ui-kit/types";
import { useI18n } from "@/hooks/useI18n";

type ClaudeImageLightboxProps = SlotPropsMap["imageLightbox"];

export function ClaudeImageLightbox({ src, alt = "", children, className, style }: ClaudeImageLightboxProps) {
  const { t } = useI18n();
  const previewLabel = t("chat.previewImage");
  const triggerLabel = alt.trim() ? `${previewLabel}: ${alt}` : previewLabel;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const closePreview = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        style={{
          display: "block",
          padding: 0,
          border: "none",
          background: "none",
          color: "inherit",
          cursor: "zoom-in",
          ...style,
        }}
        onClick={() => setOpen(true)}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={previewLabel}
      >
        {children}
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          data-cds="ImageLightbox"
          className="cds-lightbox"
          aria-label={previewLabel}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cds-lightbox-image" src={src} alt={alt} />
          <button
            ref={closeButtonRef}
            type="button"
            className="cds-lightbox-close"
            onClick={closePreview}
            aria-label={t("chat.close")}
            title={t("chat.close")}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </dialog>
      )}
    </>
  );
}
