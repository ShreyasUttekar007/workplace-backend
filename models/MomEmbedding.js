const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * One embedded chunk of a meeting record.
 * A single meeting produces several chunks (each discussion point, each
 * actionable, the remarks), so retrieval can pinpoint the exact statement
 * rather than returning a whole meeting.
 *
 * Scope fields (state / createdByEmail / zone / pc / location / district) are
 * copied onto the chunk so the SAME permission filter used by the dashboard can
 * be applied directly to retrieval.
 */
const MomEmbeddingSchema = new Schema(
  {
    momId: { type: Schema.Types.ObjectId, index: true },
    chunkType: { type: String, trim: true }, // discussion | stc_actionable | leader_actionable | remark
    text: { type: String, trim: true },
    embedding: { type: [Number], default: [] },

    // scope / filter fields (mirror MomFormat)
    state: { type: String, trim: true, index: true },
    createdByEmail: { type: String, trim: true, index: true },
    createdByName: { type: String, trim: true },
    zone: { type: String, trim: true },
    pc: { type: String, trim: true },
    location: { type: String, trim: true }, // assembly constituency
    district: { type: String, trim: true },

    // display context
    meetingDate: { type: String, trim: true },
    respondentName: { type: String, trim: true },
    respondentDesignation: { type: String, trim: true },
    respondentParty: { type: String, trim: true },
    actionable: { type: String, trim: true, default: "" },
    timeline: { type: String, trim: true, default: "" },

    model: { type: String, trim: true },
  },
  { timestamps: true }
);

MomEmbeddingSchema.index({ momId: 1, chunkType: 1, text: 1 });

module.exports = mongoose.model("MomEmbedding", MomEmbeddingSchema);
