import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cloudinaryImage } from '@/lib/cloudinary';
import { cn } from '@/lib/utils';

function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

/**
 * `size` is the avatar's width in CSS pixels (32 unless the Avatar is sized
 * otherwise), so a Cloudinary avatar is fetched at that size rather than as
 * uploaded (see `cloudinaryImage`).
 */
function AvatarImage({
  className,
  src,
  size = 32,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image> & { size?: number }) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full', className)}
      src={src ? cloudinaryImage(src, size) : src}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-xs font-medium',
        className,
      )}
      {...props}
    />
  );
}

/** "Ada Lovelace" -> "AL". Used when a user has no avatar image. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export { Avatar, AvatarImage, AvatarFallback, initials };
