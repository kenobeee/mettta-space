import type { LobbyUser } from '@chat/shared';

type Props = {
  users: LobbyUser[];
  selfId?: string;
  active: Set<string>;
  volumes: Record<string, number>;
  screenReady: Record<string, boolean>;
  onVolume: (peerId: string, value: number) => void;
  onOpenScreen: (peerId: string) => void;
};

export function ParticipantsGrid({ users, selfId, active, volumes, screenReady, onVolume, onOpenScreen }: Props) {
  if (!users.length) {
    return <div className="participants placeholder">No one here yet</div>;
  }

  return (
    <div className="participants">
      {users.map((u) => (
        <div
          key={u.id}
          className={`participant ${u.id === selfId ? 'me' : ''} ${active.has(u.id) ? 'active' : ''} ${u.handRaised ? 'hand-up' : ''}`}
        >
          {u.handRaised && <span className="hand-chip">✋</span>}
          {u.isScreenSharer && u.id !== selfId && (
            <button
              className="screen-chip"
              onClick={() => onOpenScreen(u.id)}
              title={screenReady[u.id] ? 'Открыть трансляцию экрана' : 'Поток еще загружается'}
              disabled={!screenReady[u.id]}
            >
              🖥️ Смотреть
            </button>
          )}
          <div className="avatar">{u.displayName.slice(0, 2).toUpperCase()}</div>
          <div className="name">{u.displayName}</div>
          {u.id !== selfId && (
            <div className="volume">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volumes[u.id] ?? 1}
                onChange={(e) => onVolume(u.id, parseFloat(e.target.value))}
              />
              <span>{Math.round((volumes[u.id] ?? 1) * 100)}%</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

