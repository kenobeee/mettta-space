import type { LobbyInfo } from '@chat/shared';

type Props = {
  lobbies: LobbyInfo[];
  lobbyId?: string;
  isWsReady: boolean;
  onJoin: (id: string) => void;
  onLeave: () => void;
  meetingMetaByLobby?: Record<string, { label: string; disableJoin: boolean }>;
};

export function LobbyList({ lobbies, lobbyId, isWsReady, onJoin, onLeave, meetingMetaByLobby }: Props) {
  return (
    <div className="lobbies">
      <div className="lobby-list">
        {lobbies.map((lobby) => (
          <div key={lobby.id} className={`lobby-card ${lobbyId === lobby.id ? 'active' : ''}`}>
            <div className="lobby-meta">
              <div className="lobby-name">{lobby.name}</div>
              <div className="lobby-count">{lobby.count} чел.</div>
              {meetingMetaByLobby?.[lobby.id] && (
                <div className="lobby-meeting">{meetingMetaByLobby[lobby.id].label}</div>
              )}
            </div>
            {lobbyId === lobby.id ? (
              <button className="leave-btn small" onClick={onLeave}>
                Выйти
              </button>
            ) : (
              <button
                className="primary join"
                onClick={() => onJoin(lobby.id)}
                disabled={!isWsReady || !!lobbyId || !!meetingMetaByLobby?.[lobby.id]?.disableJoin}
                title={lobbyId ? 'Вы уже в лобби' : 'Войти'}
              >
                Войти
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

