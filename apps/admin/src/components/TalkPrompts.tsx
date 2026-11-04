import { memo, useMemo, useState } from 'react';
import type { CatchEvent, RosterMember } from '@cau/shared';
import { fmtKg } from './LakeCard';

/** Câu gợi ý chung — KHÔNG nhắc tới quà (tránh "xin quà" / gift baiting). */
const GENERAL = [
  'Hôm nay mọi người xem từ tỉnh nào? Bình luận cho mình biết nhé!',
  'Ai từng đi câu thật chưa? Con cá to nhất bạn từng câu được nặng bao nhiêu?',
  'Bình luận bất kỳ là có chỗ ngồi câu trên hồ — vào ngồi chơi với mọi người nào.',
  'Mọi người thích câu cá chép hay cá lóc hơn?',
  'Kể mình nghe một kỷ niệm đi câu vui nhất của bạn đi.',
  'Cuối tuần này mọi người có định đi đâu chơi không?'
];

/**
 * Gợi ý nói chuyện cho chủ phòng: chào người vừa vào hồ, đọc tên người vừa lên cá, câu hỏi chung cho khán giả.
 * Giúp chủ phòng tương tác thật với người xem (TikTok yêu cầu LIVE có người dẫn). Không gợi ý xin quà.
 */
export const TalkPrompts = memo(function TalkPrompts({ catches, roster }: { catches: CatchEvent[]; roster: RosterMember[] }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * GENERAL.length));
  // Người vào hồ gần nhất: thời gian câu ngắn nhất.
  const newcomers = useMemo(
    () =>
      [...roster]
        .sort((a, b) => a.fishingMs - b.fishingMs)
        .slice(0, 3)
        .map((m) => m.displayName),
    [roster]
  );
  const lastCatch = catches.find((c) => c.kg > 0);

  return (
    <section className="card talk-card">
      <div className="card-head">
        <h2>💬 Gợi ý nói chuyện</h2>
        <button className="ghost small" onClick={() => setI((x) => (x + 1) % GENERAL.length)}>
          Câu khác
        </button>
      </div>
      <ul className="talk-list">
        {newcomers.length > 0 && (
          <li>
            <span className="talk-tag">Chào người mới</span>
            Chào {newcomers.join(', ')} vừa vào hồ — chúc câu được cá to nhé!
          </li>
        )}
        {lastCatch && (
          <li>
            <span className="talk-tag">Vừa lên cá</span>
            {lastCatch.displayName} vừa kéo được {lastCatch.name} {fmtKg(lastCatch.kg)} kg — tay nghề quá!
          </li>
        )}
        <li>
          <span className="talk-tag">Hỏi khán giả</span>
          {GENERAL[i]}
        </li>
      </ul>
    </section>
  );
});
