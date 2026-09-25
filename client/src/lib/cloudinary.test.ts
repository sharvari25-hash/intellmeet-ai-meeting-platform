import { describe, expect, it } from 'vitest';
import { cloudinaryImage } from './cloudinary';

const UPLOAD = 'https://res.cloudinary.com/intellmeet/image/upload';

describe('cloudinaryImage', () => {
  it('asks for a face-cropped square at twice the size shown, in the best format', () => {
    expect(cloudinaryImage(`${UPLOAD}/v1727000000/avatars/ada.jpg`, 40)).toBe(
      `${UPLOAD}/c_fill,g_face,w_80,h_80,f_auto,q_auto/v1727000000/avatars/ada.jpg`,
    );
  });

  it('keeps a transformation the URL already had, after its own', () => {
    expect(cloudinaryImage(`${UPLOAD}/e_grayscale/v1/avatars/ada.png`, 32)).toBe(
      `${UPLOAD}/c_fill,g_face,w_64,h_64,f_auto,q_auto/e_grayscale/v1/avatars/ada.png`,
    );
  });

  it.each([
    ['another host', 'https://lh3.googleusercontent.com/a/photo.jpg'],
    ['a Cloudinary video', 'https://res.cloudinary.com/intellmeet/video/upload/v1/rec.webm'],
    ['a plain-http URL', 'http://res.cloudinary.com/intellmeet/image/upload/v1/ada.jpg'],
    ['a data URL', 'data:image/png;base64,iVBORw0KGgo='],
  ])('leaves %s alone', (_label, url) => {
    expect(cloudinaryImage(url, 40)).toBe(url);
  });
});
