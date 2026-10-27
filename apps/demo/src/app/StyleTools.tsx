import { UiIcon } from './UiIcon';
import { useEffect, useRef, useState } from 'react';
import type { BubbleAppearance, SavedStyle, StudioDocument } from '@jjal/document-model';
import { applyStyle, captureStyle, changeElementStyle } from '@jjal/editor-core';
import { createStyleRepository } from '@jjal/persistence/browser';
import { ensureFont } from '../composition/fonts';
import { NumberField } from './ElementTools';

const repository = createStyleRepository();
const explain = (cause: unknown) =>
  cause instanceof Error && cause.name !== 'ZodError'
    ? cause.message
    : '스타일 이름 또는 값이 올바르지 않습니다.';
interface Props {
  doc: StudioDocument;
  targetId: string | undefined;
  composing: boolean;
  getSnapshot: () => { doc: StudioDocument; revision: number };
  onChange: (doc: StudioDocument) => void;
  onError: (cause: unknown) => void;
  onBusyChange: (busy: boolean) => void;
  beforeApply: () => void;
}
export function StyleTools(props: Props) {
  const [styles, setStyles] = useState<SavedStyle[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  useEffect(() => {
    let alive = true;
    repository
      .list()
      .then((list) => {
        if (alive) {
          setStyles(list);
          setReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(`내 스타일을 불러오지 못했습니다. ${explain(cause)}`);
      });
    return () => {
      alive = false;
    };
  }, []);
  const candidate = props.doc.elements.find((item) => item.id === props.targetId);
  const element =
    candidate?.kind === 'text' || candidate?.kind === 'bubble' ? candidate : undefined;
  const bubble = element?.kind === 'bubble' ? element : undefined;
  const outline = element?.style.outline ?? { width: 0, color: '#000000' };
  const tail = bubble?.tail;
  const side = tail?.side ?? 'bottom';
  const position = tail ? (side === 'top' || side === 'bottom' ? tail.x : tail.y) * 100 : 50;
  const length = tail
    ? (side === 'bottom'
        ? (tail.y - 0.82) / 0.18
        : side === 'top'
          ? 1 - tail.y / 0.18
          : side === 'right'
            ? (tail.x - 0.82) / 0.18
            : 1 - tail.x / 0.18) * 100
    : 100;
  function edit(patch: Parameters<typeof changeElementStyle>[2]) {
    if (!element) return;
    try {
      props.onChange(changeElementStyle(props.getSnapshot().doc, element.id, patch));
    } catch (cause) {
      props.onError(new Error(`${explain(cause)} 기존 작업은 그대로 유지됩니다.`));
    }
  }
  function editTail(
    nextSide: 'top' | 'right' | 'bottom' | 'left',
    nextPosition = position,
    nextLength = length,
  ) {
    if (
      ![nextPosition, nextLength].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 100,
      )
    ) {
      props.onError(
        new Error('꼬리 위치와 길이는 0~100%로 입력해 주세요. 기존 작업은 유지됩니다.'),
      );
      return;
    }
    const p = nextPosition / 100,
      l = nextLength / 100;
    edit({
      bubble: {
        tail: {
          side: nextSide,
          x: nextSide === 'left' ? 0.18 * (1 - l) : nextSide === 'right' ? 0.82 + 0.18 * l : p,
          y: nextSide === 'top' ? 0.18 * (1 - l) : nextSide === 'bottom' ? 0.82 + 0.18 * l : p,
        },
      },
    });
  }
  async function action(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    props.onBusyChange(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(`${explain(cause)} 기존 작업과 저장된 스타일은 유지됩니다.`);
    } finally {
      running.current = false;
      setBusy(false);
      props.onBusyChange(false);
    }
  }
  async function save(update: boolean) {
    const current = props.getSnapshot();
    const previous = update ? styles.find((item) => item.id === selected) : undefined;
    if (update && !previous) throw new Error('수정할 스타일을 선택해 주세요.');
    const style = captureStyle(current.doc, props.targetId ?? '', name, previous);
    await repository.save(style, update ? 'update' : 'create');
    setStyles(await repository.list());
    setSelected(style.id);
    setName(style.name);
    setNotice(`‘${style.name}’ 스타일을 ${update ? '수정' : '저장'}했습니다.`);
  }
  async function apply() {
    const style = styles.find((item) => item.id === selected);
    if (!style || !element) throw new Error('스타일과 적용할 문구를 선택해 주세요.');
    props.beforeApply();
    const snapshot = props.getSnapshot();
    if (style.text.font.kind !== 'builtin') throw new Error('제공 글꼴만 사용할 수 있습니다.');
    await ensureFont(style.text.font.family);
    const current = props.getSnapshot();
    if (current.revision !== snapshot.revision || current.doc.id !== snapshot.doc.id)
      throw new Error('준비 중 편집 내용이 바뀌어 적용을 취소했습니다. 다시 적용해 주세요.');
    props.onChange(applyStyle(current.doc, element.id, style));
    setNotice(`‘${style.name}’ 스타일을 적용했습니다. 내용과 배치는 유지됩니다.`);
  }
  return (
    <div
      className="tool-section style-tools"
      role="region"
      aria-label="말풍선과 내 스타일"
      aria-busy={busy}
    >
      <h2>
        <UiIcon name="style" /> 말풍선과 문구 스타일
      </h2>
      <fieldset disabled={!element || props.composing || busy || element.locked}>
        <legend>편집할 문구의 서식</legend>
        {bubble && (
          <>
            <label>
              말풍선 모양
              <select
                aria-label="말풍선 모양"
                value={bubble.customShape ? 'custom' : bubble.shape}
                onChange={(event) => {
                  const shape = event.target.value as BubbleAppearance['shape'];
                  edit({
                    bubble: {
                      shape,
                      tail:
                        shape === 'caption'
                          ? null
                          : (bubble.tail ?? { x: 0.5, y: 1, side: 'bottom' }),
                    },
                  });
                }}
              >
                {bubble.customShape && <option value="custom">가져온 말풍선</option>}
                <option value="speech">대화</option>
                <option value="thought">생각</option>
                <option value="shout">외침</option>
                <option value="caption">설명</option>
              </select>
            </label>
            <fieldset className="bubble-text-layout">
              <legend>말풍선 글자 배치</legend>
              <button
                type="button"
                onClick={() =>
                  edit({ text: { align: 'center' }, bubble: { verticalAlign: 'center' } })
                }
              >
                상하좌우 가운데 정렬
              </button>
              <label>
                세로 정렬
                <select
                  aria-label="말풍선 세로 정렬"
                  value={bubble.verticalAlign ?? 'top'}
                  onChange={(event) =>
                    edit({
                      bubble: { verticalAlign: event.target.value as 'top' | 'center' | 'bottom' },
                    })
                  }
                >
                  <option value="top">위</option>
                  <option value="center">가운데</option>
                  <option value="bottom">아래</option>
                </select>
              </label>
              <div className="element-grid">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <NumberField
                    key={`${bubble.id}-padding-${side}`}
                    label={`말풍선 ${{ top: '위', right: '오른쪽', bottom: '아래', left: '왼쪽' }[side]} 여백`}
                    min={0}
                    max={200}
                    value={bubble.textPadding?.[side] ?? 12}
                    apply={(value) =>
                      edit({
                        bubble: {
                          textPadding: {
                            top: 12,
                            right: 12,
                            bottom: 12,
                            left: 12,
                            ...bubble.textPadding,
                            [side]: value,
                          },
                        },
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
            {!bubble.customShape && (bubble.shape === 'speech' || bubble.shape === 'caption') && (
              <fieldset className="bubble-corner-tools">
                <legend>모서리 둥글기</legend>
                <div className="element-grid">
                  {(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const).map((corner) => (
                    <NumberField
                      key={`${bubble.id}-corner-${corner}`}
                      label={`${{ topLeft: '왼쪽 위', topRight: '오른쪽 위', bottomRight: '오른쪽 아래', bottomLeft: '왼쪽 아래' }[corner]} 모서리 둥글기`}
                      min={0}
                      max={50}
                      value={bubble.corners?.[corner] ?? 10}
                      apply={(value) =>
                        edit({
                          bubble: {
                            corners: {
                              topLeft: 10,
                              topRight: 10,
                              bottomRight: 10,
                              bottomLeft: 10,
                              ...bubble.corners,
                              [corner]: value,
                            },
                          },
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>
            )}
            {bubble.shape === 'shout' && (
              <NumberField
                key={`${bubble.id}-sharpness`}
                label="뾰족한 정도"
                min={0}
                max={100}
                value={bubble.spikeSharpness ?? 40}
                apply={(value) => edit({ bubble: { spikeSharpness: value } })}
              />
            )}
            <div className="element-grid">
              <label>
                말풍선 채우기 색
                <input
                  type="color"
                  aria-label="말풍선 채우기 색"
                  value={bubble.fill}
                  onChange={(event) => edit({ bubble: { fill: event.target.value } })}
                />
              </label>
            </div>
            {bubble.shape !== 'caption' && (
              <>
                <label className="check-row">
                  <input
                    aria-label="말풍선 꼬리 표시"
                    type="checkbox"
                    checked={Boolean(tail)}
                    onChange={(event) =>
                      event.target.checked
                        ? editTail('bottom', 50, 100)
                        : edit({ bubble: { tail: null } })
                    }
                  />
                  꼬리 표시
                </label>
                <fieldset disabled={!tail}>
                  <legend>꼬리 조절</legend>
                  <label>
                    꼬리 방향
                    <select
                      aria-label="꼬리 방향"
                      value={side}
                      onChange={(event) =>
                        editTail(
                          event.target.value as typeof side,
                          Math.max(0, Math.min(100, position)),
                          Math.max(0, Math.min(100, length)),
                        )
                      }
                    >
                      <option value="bottom">아래</option>
                      <option value="top">위</option>
                      <option value="left">왼쪽</option>
                      <option value="right">오른쪽</option>
                    </select>
                  </label>
                  <div className="element-grid">
                    <NumberField
                      key={`${bubble.id}-${side}-position`}
                      label="꼬리 위치"
                      min={0}
                      max={100}
                      value={Math.round(position * 100) / 100}
                      apply={(value) => editTail(side, value, Math.max(0, Math.min(100, length)))}
                    />
                    <NumberField
                      key={`${bubble.id}-${side}-length`}
                      label="꼬리 길이"
                      min={0}
                      max={100}
                      value={Math.round(length * 100) / 100}
                      apply={(value) => editTail(side, Math.max(0, Math.min(100, position)), value)}
                    />
                  </div>
                </fieldset>
              </>
            )}
          </>
        )}
        <label>
          문구 정렬
          <select
            aria-label="문구 정렬"
            value={element?.style.align ?? 'center'}
            onChange={(event) =>
              edit({ text: { align: event.target.value as 'left' | 'center' | 'right' } })
            }
          >
            <option value="left">왼쪽</option>
            <option value="center">가운데</option>
            <option value="right">오른쪽</option>
          </select>
        </label>
        {bubble && (
          <>
            <label className="check-row">
              <input
                type="checkbox"
                aria-label="문구 외곽선 표시"
                checked={outline.width > 0}
                onChange={(event) =>
                  edit({ text: { outline: { ...outline, width: event.target.checked ? 4 : 0 } } })
                }
              />
              문구 외곽선 표시
            </label>
            <div className="element-grid">
              <label>
                문구 외곽선 색
                <input
                  type="color"
                  aria-label="문구 외곽선 색"
                  value={outline.color}
                  onChange={(event) =>
                    edit({ text: { outline: { ...outline, color: event.target.value } } })
                  }
                />
              </label>
              <NumberField
                key={`${element?.id}-outline`}
                label="문구 외곽선 두께"
                min={0}
                max={20}
                value={outline.width}
                apply={(value) => edit({ text: { outline: { ...outline, width: value } } })}
              />
            </div>
          </>
        )}
      </fieldset>
      <fieldset disabled={!ready || busy || props.composing}>
        <legend>내 스타일</legend>
        <label>
          스타일 이름
          <input
            aria-label="스타일 이름"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          저장된 스타일
          <select
            aria-label="저장된 스타일"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setName(styles.find((item) => item.id === event.target.value)?.name ?? '');
            }}
          >
            <option value="">스타일 선택</option>
            {styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.name} · {style.bubble ? '말풍선+문구' : '문구'}
              </option>
            ))}
          </select>
        </label>
        <div className="element-buttons">
          <button disabled={!element} onClick={() => void action(() => save(false))}>
            새 스타일 저장
          </button>
          <button disabled={!element || !selected} onClick={() => void action(() => save(true))}>
            선택 스타일 수정
          </button>
          <button
            disabled={!element || element.locked || !selected}
            onClick={() => void action(apply)}
          >
            스타일 적용
          </button>
          <button
            disabled={!selected}
            onClick={() => {
              const style = styles.find((item) => item.id === selected);
              if (
                !style ||
                !window.confirm(`‘${style.name}’ 스타일을 삭제할까요? 적용된 작품은 유지됩니다.`)
              )
                return;
              void action(async () => {
                await repository.remove(selected);
                setStyles(await repository.list());
                setSelected('');
                setName('');
                setNotice('스타일을 삭제했습니다. 적용된 작품은 유지됩니다.');
              });
            }}
          >
            선택 스타일 삭제
          </button>
        </div>
      </fieldset>

      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
