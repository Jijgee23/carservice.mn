-- «Онлайн цаг захиалга» (online_booking) багцын модуль «Цаг захиалга»
-- (enable_appointments)-д нэгдэв. Онлайнаар захиалга авах эсэхийг багц биш,
-- байгууллагын Tenant.acceptsOnlineBooking тохиргоо шийднэ.
DELETE FROM "PlanLimit" WHERE "code" = 'online_booking';
