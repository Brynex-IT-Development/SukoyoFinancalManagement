import express from "express";
import {
  listTutors, createTutor, updateTutor, listClasses, getClass, createClass, updateClass, listBookings, createBooking, changeBookingStatus,
} from "../controllers/ClassController.js";

const router = express.Router();

// Classes, tutors and bookings (F20)
router.get("/tutors", listTutors);
router.post("/tutors", createTutor);
router.put("/tutors/:id", updateTutor);
router.get("/classes", listClasses);
router.post("/classes", createClass);
router.get("/classes/:id", getClass);
router.put("/classes/:id", updateClass);
router.get("/bookings", listBookings);
router.post("/bookings", createBooking);
router.post("/bookings/:id/status", changeBookingStatus);

export default router;
