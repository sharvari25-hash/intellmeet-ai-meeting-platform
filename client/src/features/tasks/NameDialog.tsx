import { useEffect, useState, type FormEvent } from 'react';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** One text field in a dialog: naming a board, adding or renaming a column. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial = '',
  submitLabel,
  maxLength,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  initial?: string;
  submitLabel: string;
  maxLength: number;
  pending: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);

  // A fresh start each time it opens, from whatever the current name is.
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="name-dialog-input">{label}</Label>
            <Input
              id="name-dialog-input"
              value={value}
              maxLength={maxLength}
              autoFocus
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !value.trim()}>
              {pending && <Spinner label="Saving" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
