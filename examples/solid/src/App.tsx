import { RoomRoute } from './routes/RoomRoute';

export default function App() {
  return (
    <div>
      <h1> @kidlib/p2p - SolidJS Example App</h1>
      <p>
        This is a simple example of a peer-to-peer video call application built
        with SolidJS and KidLib P2P. Click the button below to start a call, and
        share the generated link with someone else to join the call.
      </p>
      <p>
        Note: This example uses browser tab signaling, so both participants need
        to be on the same browser for it to work.
      </p>
      <hr />
      <RoomRoute />
    </div>
  );
}
