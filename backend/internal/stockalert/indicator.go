package stockalert

import (
	"fmt"
	"math"
	"time"
)

func BuildFeatures(klines []Kline, intraday IntradaySnapshot, quote Quote) (Features, error) {
	if len(klines) == 0 {
		return Features{}, fmt.Errorf("%w: no klines", ErrInsufficientData)
	}
	closes := make([]float64, 0, len(klines))
	for _, kline := range klines {
		closes = append(closes, kline.Close)
	}
	last := closes[len(closes)-1]
	features := Features{
		LastClose:     last,
		ChangePct:     quote.ChangePct,
		MA5:           movingAverage(closes, 5),
		MA10:          movingAverage(closes, 10),
		MA20:          movingAverage(closes, 20),
		MA60:          movingAverage(closes, 60),
		RSI14:         rsi(closes, 14),
		BollUpper:     bollinger(closes, 20, 2, true),
		BollMid:       movingAverage(closes, 20),
		BollLower:     bollinger(closes, 20, 2, false),
		High60:        highLow(closes, 60).high,
		Low60:         highLow(closes, 60).low,
		VolumeRatio:   volumeRatio(klines),
		Return20:      intervalReturn(closes, 20),
		Return60:      intervalReturn(closes, 60),
		Return90:      intervalReturn(closes, 90),
		MaxDrawdown:   maxDrawdown(closes),
		DataStartDate: klines[0].Date,
		DataEndDate:   klines[len(klines)-1].Date,
		KlineCount:    len(klines),
	}
	features.DIF, features.DEA, features.MACD = macd(closes)
	if len(intraday.Points) > 0 {
		features.IntradayPrice = intraday.Latest.Price
		features.IntradayAvg = intraday.Latest.AvgPrice
		features.IntradayAboveAvg = intraday.Latest.AvgPrice <= 0 || intraday.Latest.Price >= intraday.Latest.AvgPrice
		features.IntradayPoints = len(intraday.Points)
		features.Latest5mChange = latest5mChange(intraday.Points)
		features.VolumePerMinute = intraday.Latest.Volume
	}
	return features, nil
}

type rangeValue struct {
	high float64
	low  float64
}

func movingAverage(values []float64, period int) float64 {
	if period <= 0 || len(values) < period {
		return 0
	}
	var sum float64
	for _, value := range values[len(values)-period:] {
		sum += value
	}
	return sum / float64(period)
}

func rsi(values []float64, period int) float64 {
	if len(values) <= period {
		return 50
	}
	var gains, losses float64
	for i := len(values) - period; i < len(values); i++ {
		diff := values[i] - values[i-1]
		if diff >= 0 {
			gains += diff
		} else {
			losses -= diff
		}
	}
	averageGain := gains / float64(period)
	averageLoss := losses / float64(period)
	if averageLoss == 0 {
		return 100
	}
	rs := averageGain / averageLoss
	return 100 - 100/(1+rs)
}

func bollinger(values []float64, period int, multiplier float64, upper bool) float64 {
	mid := movingAverage(values, period)
	if mid == 0 || len(values) < period {
		return 0
	}
	var sum float64
	for _, value := range values[len(values)-period:] {
		diff := value - mid
		sum += diff * diff
	}
	stddev := math.Sqrt(sum / float64(period))
	if upper {
		return mid + multiplier*stddev
	}
	return mid - multiplier*stddev
}

func macd(values []float64) (dif float64, dea float64, hist float64) {
	if len(values) == 0 {
		return 0, 0, 0
	}
	ema12 := values[0]
	ema26 := values[0]
	difs := make([]float64, 0, len(values))
	for _, value := range values {
		ema12 = value*2/13 + ema12*(1-2/13)
		ema26 = value*2/27 + ema26*(1-2/27)
		difs = append(difs, ema12-ema26)
	}
	dif = difs[len(difs)-1]
	dea = ema(difs, 9)
	hist = (dif - dea) * 2
	return
}

func ema(values []float64, period int) float64 {
	if len(values) == 0 || period <= 0 {
		return 0
	}
	multiplier := 2.0 / float64(period+1)
	value := values[0]
	for _, item := range values[1:] {
		value = item*multiplier + value*(1-multiplier)
	}
	return value
}

func highLow(values []float64, count int) rangeValue {
	start := 0
	if len(values) > count {
		start = len(values) - count
	}
	if start >= len(values) {
		return rangeValue{}
	}
	high, low := values[start], values[start]
	for _, value := range values[start:] {
		if value > high {
			high = value
		}
		if value < low {
			low = value
		}
	}
	return rangeValue{high: high, low: low}
}

func intervalReturn(values []float64, days int) float64 {
	if len(values) <= 1 {
		return 0
	}
	start := 0
	if len(values) > days {
		start = len(values) - days
	}
	base := values[start]
	if base == 0 {
		return 0
	}
	return (values[len(values)-1] - base) / base * 100
}

func maxDrawdown(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	peak := values[0]
	maxDrop := 0.0
	for _, value := range values {
		if value > peak {
			peak = value
		}
		if peak > 0 {
			drop := (peak - value) / peak * 100
			if drop > maxDrop {
				maxDrop = drop
			}
		}
	}
	return maxDrop
}

func volumeRatio(klines []Kline) float64 {
	if len(klines) < 6 {
		return 1
	}
	var sum float64
	for _, kline := range klines[len(klines)-6 : len(klines)-1] {
		sum += kline.Volume
	}
	average := sum / 5
	if average <= 0 {
		return 1
	}
	return klines[len(klines)-1].Volume / average
}

func latest5mChange(points []IntradayPoint) float64 {
	if len(points) < 2 {
		return 0
	}
	last := points[len(points)-1]
	lastTime, err := time.ParseInLocation("2006-01-02 15:04", last.Time, time.Local)
	if err != nil {
		return 0
	}
	base := points[len(points)-1].Price
	for i := len(points) - 2; i >= 0; i-- {
		pointTime, err := time.ParseInLocation("2006-01-02 15:04", points[i].Time, time.Local)
		if err != nil {
			continue
		}
		if lastTime.Sub(pointTime) >= 5*time.Minute {
			base = points[i].Price
			break
		}
	}
	if base <= 0 {
		return 0
	}
	return (last.Price - base) / base * 100
}
