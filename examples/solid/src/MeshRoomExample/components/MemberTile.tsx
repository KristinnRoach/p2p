import VideoStream from './VideoStream';

type Props = {
  memberId: string;
  stream?: MediaStream;
};

export default function MemberTile(props: Props) {
  return (
    <section class='peer-tile'>
      <h2>Remote {props.memberId.slice(0, 8)}</h2>
      <VideoStream stream={props.stream} />
    </section>
  );
}
