import { createEffect, onCleanup } from 'solid-js';

type Props = {
  stream?: MediaStream;
  muted?: boolean;
};

export function VideoStream(props: Props) {
  let video!: HTMLVideoElement;

  createEffect(() => {
    const stream = props.stream;
    if (!video || !stream) return;

    video.srcObject = stream;
    video.play().catch(() => {});

    onCleanup(() => {
      video.srcObject = null;
    });
  });

  return <video ref={video} autoplay playsinline muted={props.muted} />;
}
