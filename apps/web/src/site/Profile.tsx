const STATS = [
  { icon: '🏆', label: 'ELO', value: '1.842', sub: '+24' },
  { icon: '◎', label: 'PARTIDAS', value: '217', sub: '+3 hoje' },
  { icon: '📈', label: 'VITÓRIAS', value: '58%', sub: '125V / 92D' },
  { icon: '🔥', label: 'SEQUÊNCIA', value: '3', sub: 'vitórias' },
];

const MATCHES = [
  { win: true, pts: 10, map: 'Base', vs: 'marina_dev, rafa, joana', delta: 24, when: 'há 1h' },
  { win: false, pts: 7, map: 'Beira-mar', vs: 'tio_pedro, luca', delta: -12, when: 'há 4h' },
  { win: true, pts: 10, map: 'Cavaleiros', vs: 'ana_p, marina_dev, joana', delta: 18, when: 'ontem' },
  { win: false, pts: 6, map: 'Base', vs: 'rafa, luca', delta: -9, when: 'ontem' },
  { win: true, pts: 10, map: 'Cidades & C.', vs: 'joana, tio_pedro, marina_dev', delta: 22, when: '2 dias' },
];

const ACHIEVEMENTS = [
  { name: 'Primeira vila', on: true },
  { name: 'Estrada longa', on: true },
  { name: 'Maior exército', on: true },
  { name: 'Monopólio', on: true },
  { name: '10 vitórias', on: true },
  { name: 'Sem trocas', on: true },
  { name: 'Rush portos', on: true },
  { name: 'Mestre da pedra', on: false },
  { name: 'Grão-Mestre', on: false },
];

export function Profile() {
  return (
    <div className="page profile">
      <div className="card profile-head">
        <span className="avatar">V</span>
        <div className="profile-id">
          <span className="eyebrow">COLONO · NÍVEL 14</span>
          <h1>você_jogador</h1>
          <span className="muted-note">Entrou em fev/2026 · Servidor BR-Sul</span>
        </div>
        <button className="ghost">⚙ Editar perfil</button>
      </div>

      <div className="stat-row">
        {STATS.map((s) => (
          <div key={s.label} className="card stat-box">
            <span className="eyebrow">{s.icon} {s.label}</span>
            <span className="stat-value">{s.value}</span>
            <span className="muted-note">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="profile-cols">
        <div className="card">
          <div className="card-head">
            <h2>Últimas partidas</h2>
            <a className="muted-note">Ver tudo</a>
          </div>
          {MATCHES.map((m, i) => (
            <div key={i} className="match-row">
              <span className={`dot ${m.win ? 'win' : 'loss'}`} />
              <div className="match-info">
                <b>{m.win ? 'Vitória' : 'Derrota'}</b> · {m.pts} pts · {m.map}
                <small>vs {m.vs}</small>
              </div>
              <div className="match-delta">
                <span className={m.delta > 0 ? 'up' : 'down'}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                <small>{m.when}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Conquistas</h2>
          <p className="muted-note">7 de 32 desbloqueadas</p>
          <div className="ach-grid">
            {ACHIEVEMENTS.map((a) => (
              <div key={a.name} className={`ach${a.on ? '' : ' off'}`}>
                <span className="ach-medal">🎖️</span>
                <span>{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
