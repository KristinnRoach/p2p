import { RoomRoute } from './routes/RoomRoute';

export default function App() {
  return (
    <div class='app'>
      <header class='intro'>
        <h1>@kidlib/p2p - SolidJS Example Room (mesh)</h1>
        <p>Click the button below to create a room.</p>
        <p>
          Note: This example uses browser tab signaling, so both participants
          need to be on the same browser for it to work.
        </p>
      </header>
      <RoomRoute />
    </div>
  );
}
