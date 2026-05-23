// src/components/regimens/RegimenReviewsBlock.jsx
//
// Expanded "Reviews" section rendered inside an open RegimenCard.
// Shows:
//   • Aggregate stars + count + average
//   • Up to 5 recent reviews with author email + stars + comment
//   • Your-review composer (stars + textarea + Submit)
//
// Submit is gated server-side by the adoption trigger (mig 118):
// non-adopters see a clear "Adopt the regimen to leave a review."
// hint after their submit attempt is rejected.

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import StarRating from './StarRating';
import * as reviews from '@/lib/data/regimenReviews';

export default function RegimenReviewsBlock({ regimenId, user }) {
  const queryClient = useQueryClient();
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['regimenReviews', regimenId],
    queryFn:  () => reviews.listForRegimen(regimenId, 10),
    enabled:  !!regimenId,
    staleTime: 60_000,
  });
  const { data: agg } = useQuery({
    queryKey: ['regimenReviewAgg', regimenId],
    queryFn:  async () => (await reviews.aggregatesFor([regimenId])).get(regimenId) || null,
    enabled:  !!regimenId,
    staleTime: 60_000,
  });
  const { data: mine } = useQuery({
    queryKey: ['regimenMyReview', regimenId, user?.id],
    queryFn:  () => reviews.getMyReview(regimenId, user.id),
    enabled:  !!regimenId && !!user?.id,
    staleTime: 60_000,
  });

  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [adoptionError, setAdoptionError] = useState(false);

  // When the existing review loads, seed the composer with the
  // current values so editing feels continuous.
  useEffect(() => {
    if (mine) {
      setStars(mine.rating);
      setComment(mine.comment || '');
    }
  }, [mine?.id]);

  const onSubmit = async () => {
    if (!user?.id || stars < 1) return;
    setSubmitting(true);
    setAdoptionError(false);
    const res = await reviews.submit({
      regimenId, rating: stars, comment, userId: user.id, email: user.email,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(mine ? 'Review updated.' : 'Thanks for the review!');
      queryClient.invalidateQueries({ queryKey: ['regimenReviews', regimenId] });
      queryClient.invalidateQueries({ queryKey: ['regimenReviewAgg', regimenId] });
      queryClient.invalidateQueries({ queryKey: ['regimenMyReview', regimenId, user.id] });
    } else if (res.code === 'needs_adoption') {
      setAdoptionError(true);
    } else {
      toast.error('Could not submit review. Try again.');
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
      {/* Aggregate header */}
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Reviews</h4>
        {agg && agg.review_count > 0 && (
          <div className="flex items-center gap-1.5">
            <StarRating value={agg.avg_rating} size="sm" />
            <span className="text-xs font-semibold">
              {agg.avg_rating.toFixed(1)}
              <span className="text-muted-foreground"> · {agg.review_count}</span>
            </span>
          </div>
        )}
      </div>

      {/* Reviews list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No reviews yet — be the first.</p>
      ) : (
        <ul className="space-y-2">
          {list.slice(0, 5).map(r => (
            <li key={r.id} className="text-xs">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <StarRating value={r.rating} size="sm" />
                  <span className="text-muted-foreground truncate">
                    {r.reviewer_email?.split('@')[0] || 'Athlete'}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {(() => { try { return formatDistanceToNowStrict(new Date(r.created_at), { addSuffix: true }); } catch { return ''; } })()}
                </span>
              </div>
              {r.comment && (
                <p className="text-foreground/90 leading-snug whitespace-pre-wrap">{r.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Composer — only when signed in */}
      {user?.id && (
        <div className="pt-2 border-t border-border/40 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {mine ? 'Update your review' : 'Add your review'}
          </p>
          <StarRating value={stars} onChange={(n) => { setStars(n); setAdoptionError(false); }} size="md" />
          {stars > 0 && (
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 600))}
              placeholder="What worked? What didn't? (optional)"
              rows={2}
              maxLength={600}
              className="w-full px-2 py-1.5 bg-secondary/40 border border-border rounded-md text-xs outline-none focus:border-primary/50 resize-none"
            />
          )}
          {adoptionError && (
            <p className="text-[11px] text-amber-500">
              Adopt the regimen first — only users who've tried it can review.
            </p>
          )}
          {stars > 0 && (
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="text-[11px] font-bold uppercase tracking-wide px-3 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : mine ? 'Update review' : 'Submit review'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
