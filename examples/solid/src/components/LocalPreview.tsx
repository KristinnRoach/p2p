import { VideoStream } from './VideoStream';

type Props = {
  stream?: MediaStream;
};

export function LocalPreview(props: Props) {
  return (
    <section>
      <h2>Local</h2>
      <VideoStream stream={props.stream} muted />
    </section>
  );
}
