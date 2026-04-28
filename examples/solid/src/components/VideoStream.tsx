import { createEffect, onCleanup } from 'solid-js';

type Props = {
  stream?: MediaStream;
  muted?: boolean;
  label?: string;
};

export function VideoStream(props: Props) {
  let video!: HTMLVideoElement;

  createEffect(() => {
    const stream = props.stream;
    console.info(`VideoStream for ${props.label} - stream changed: ${stream}`);

    if (!video) return;

    video.srcObject = stream ?? null;
    if (stream) {
      video.play().catch(() => {});
    }

    onCleanup(() => {
      video.srcObject = null;
    });
  });

  return <video ref={video} autoplay playsinline muted={props.muted} />;
}
