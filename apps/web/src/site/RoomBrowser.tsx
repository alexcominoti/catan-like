interface Room {
  name: string;
  host: string;
  map: string;
  mode: 'Casual' | 'Ranqueada' | 'Velocidade';
  cur: number;
  max: number;
  ping: number;
  locked?: boolean;
}

const ROOMS: Room[] = [
  { name: 'Sal da Ilha', host: 'marina_dev', map: 'Base', mode: 'Casual', cur: 3, max: 4, ping: 18 },
  { name: 'Brick Lords', host: 'rafa', map: 'Beira-mar', mode: 'Ranqueada', cur: 2, max: 4, ping: 22 },
  { name: 'Café com Catan', host: 'joana', map: 'Cidades & Cavalaria', mode: 'Casual', cur: 4, max: 6, ping: 30 },
  { name: 'Sem dó', host: 'tio_pedro', map: 'Base', mode: 'Ranqueada', cur: 1, max: 3, ping: 14, locked: true },
  { name: 'Tabuleiro do Vô', host: 'luca', map: 'Cavaleiros', mode: 'Casual', cur: 3, max: 4, ping: 41 },
  { name: 'Rush Madeira', host: 'ana_p', map: 'Base', mode: 'Velocidade', cur: 2, max: 4, ping: 19 },
];

const MODE_CLASS: Record<Room['mode'], string> = {
  Casual: 'casual',
  Ranqueada: 'ranked',
  Velocidade: 'speed',
};

export function RoomBrowser({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">LOBBY</span>
          <h1>Escolha uma mesa.</h1>
        </div>
        <button className="cta" onClick={onPlay}>+ Criar salão</button>
      </div>

      <div className="quick-cards">
        <div className="quick-card">
          <span className="quick-icon">⚡</span>
          <h3>Jogo rápido</h3>
          <p>Entramos em qualquer mesa casual aberta.</p>
          <button className="dark" onClick={onPlay}>Jogar</button>
        </div>
        <div className="quick-card green">
          <span className="quick-icon">👥</span>
          <h3>Ranqueada</h3>
          <p>Suba sua pontuação na temporada de junho.</p>
          <button className="dark" onClick={onPlay}>Encontrar partida</button>
        </div>
        <div className="quick-card">
          <span className="quick-icon">🔒</span>
          <h3>Partida privada</h3>
          <p>Crie um link e chame quem você quiser.</p>
          <button className="dark" onClick={onPlay}>Gerar link</button>
        </div>
      </div>

      <div className="room-toolbar">
        <input placeholder="🔎  Buscar por nome do salão ou host…" />
        <button className="ghost">▽ Mapa</button>
        <button className="ghost">▽ Modo</button>
      </div>

      <div className="room-table">
        <div className="room-row head">
          <span>SALÃO</span><span>MAPA</span><span>MODO</span><span>JOGADORES</span><span>PING</span><span></span>
        </div>
        {ROOMS.map((r) => (
          <div key={r.name} className="room-row">
            <span className="room-name">
              <b>{r.locked ? '🔒 ' : '🟢 '}{r.name}</b>
              <small>por @{r.host}</small>
            </span>
            <span>{r.map}</span>
            <span><span className={`mode ${MODE_CLASS[r.mode]}`}>{r.mode}</span></span>
            <span className="seats">
              {Array.from({ length: r.max }, (_, i) => (
                <i key={i} className={i < r.cur ? 'on' : ''} />
              ))}
              <small> {r.cur}/{r.max}</small>
            </span>
            <span className="ping">{r.ping}ms</span>
            <span><button className="cta sm" onClick={onPlay}>Entrar</button></span>
          </div>
        ))}
      </div>
    </div>
  );
}
