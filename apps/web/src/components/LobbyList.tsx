import type { LobbyInfo } from '@chat/shared';

type Props = {
  lobbies: LobbyInfo[];
  lobbyId?: string;
  isWsReady: boolean;
  onJoin: (id: string) => void;
  onLeave: () => void;
};

export function LobbyList({ lobbies, lobbyId, isWsReady, onJoin, onLeave }: Props) {
  return (
    <div className="lobbies">
      <div className="lobby-list">
        {lobbies.map((lobby) => (
          <div key={lobby.id} className={`lobby-card ${lobbyId === lobby.id ? 'active' : ''}`}>
            <div className="lobby-meta">
              <div className="lobby-name">{lobby.name}</div>
              <div className="lobby-count">{lobby.count} чел.</div>
            </div>
            {lobbyId === lobby.id ? (
              <button className="leave-btn small" onClick={onLeave}>
                Выйти
              </button>
            ) : (
              <button className="primary join" onClick={() => onJoin(lobby.id)} disabled={!isWsReady}>
                Войти
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

