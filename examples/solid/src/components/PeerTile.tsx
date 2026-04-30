import VideoStream from './VideoStream';

type Props = {
  peerId: string;
  stream?: MediaStream;
};

export default function PeerTile(props: Props) {
  return (
    <section class='peer-tile'>
      <h2>Remote {props.peerId.slice(0, 8)}</h2>
      <VideoStream stream={props.stream} />
    </section>
  );
}
