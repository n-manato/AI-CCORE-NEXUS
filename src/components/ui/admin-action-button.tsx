"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

// A button that optionally requires a confirmation dialog before running an
// async action. Used for admin emergency operations; dangerous ones use red
// styling and always confirm.
export function AdminActionButton({
  label,
  icon,
  onConfirm,
  confirmTitle,
  confirmMessage,
  requireConfirm = true,
  danger = false,
  variant,
  size = "sm",
  disabled,
}: {
  label: string;
  icon?: React.ReactNode;
  onConfirm: () => Promise<void> | void;
  confirmTitle?: string;
  confirmMessage?: React.ReactNode;
  requireConfirm?: boolean;
  danger?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={variant ?? (danger ? "danger" : "secondary")}
        size={size}
        disabled={disabled || busy}
        onClick={() => (requireConfirm ? setOpen(true) : run())}
      >
        {icon}
        {label}
      </Button>
      {requireConfirm && (
        <ConfirmDialog
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={run}
          title={confirmTitle ?? label}
          message={confirmMessage ?? `Are you sure you want to ${label.toLowerCase()}?`}
          confirmLabel={label}
          danger={danger}
        />
      )}
    </>
  );
}
